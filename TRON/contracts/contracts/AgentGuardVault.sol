// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title AgentGuardVault (TRON)
 * @notice AgentGuard — AI 에이전트 지출 방화벽 및 블랙박스 (TRON 온체인 금고)
 *
 *  - 오너(사용자)가 정책(누적 예산·기한·승인 필요 여부)과 허용 판매자를 정한다.
 *  - AI 에이전트는 `requestSpend` 로 결제를 "요청"만 할 수 있고, 허용/차단은 이 코드가 결정한다.
 *  - 승인·차단·보류·거절·긴급중지 등 모든 판정은 `auditLogs` 에 순서대로 쌓이고
 *    `AuditRecorded` 이벤트로도 남는다(append-only 블랙박스).
 *  - 가디언(모니터링 주체)은 긴급 중지만 할 수 있고, 해제는 오너만 할 수 있다.
 *
 * @dev 차단 판정은 revert 하지 않는다. revert 하면 감사 기록까지 함께 롤백되어
 *      "왜 차단되었는지" 가 온체인에 남지 않기 때문이다. 권한 없는 호출·중복 requestId 같은
 *      입력 오류만 revert 한다.
 *
 *      금액 단위는 sun (1 TRX = 1,000,000 sun). 데모에서는 1원 = 1 sun 으로 고정 환산한다.
 *      TVM 호환을 위해 evmVersion=paris 로 컴파일한다 (PUSH0/MCOPY/TSTORE 미사용).
 */
contract AgentGuardVault is Ownable2Step, Pausable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Policy {
        uint256 budget; // 수수료 포함, 현재 정책 기간 동안의 누적 최대 지출액
        uint256 deadline; // unix seconds, 이 시각 이후 요청은 차단
        bool requireHumanApproval; // true 면 사용자가 approveSpend 해야 송금
    }

    struct AuditRecord {
        uint256 requestId;
        address merchant;
        uint256 amount;
        bool isApproved;
        string reason;
        uint256 timestamp;
    }

    struct PendingRequest {
        address payable merchant;
        uint256 amount;
        uint256 policyVersion;
        bool exists;
    }

    // ---------------------------------------------------------------------
    // Audit reasons (프론트엔드 타임라인과 공유하는 고정 문자열)
    // ---------------------------------------------------------------------

    string public constant REASON_APPROVED = "Approved";
    string public constant REASON_PENDING = "Pending Human Approval";
    string public constant REASON_REJECTED = "Rejected by User";
    string public constant REASON_EXCEEDED_BUDGET = "Exceeded Budget";
    string public constant REASON_UNREGISTERED_MERCHANT = "Unregistered Merchant";
    string public constant REASON_POLICY_EXPIRED = "Policy Expired";
    string public constant REASON_POLICY_CHANGED = "Policy Changed";
    string public constant REASON_INSUFFICIENT_BALANCE = "Insufficient Vault Balance";
    string public constant REASON_EMERGENCY_PAUSED = "Emergency Paused";

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice 결제 요청 권한이 있는 AI 에이전트 주소
    address public aiAgent;
    /// @notice 긴급 중지 권한만 가진 가디언 주소 (없으면 address(0))
    address public guardian;
    /// @notice 허용 판매자 목록
    mapping(address => bool) public approvedMerchants;
    /// @notice 현재 지출 정책
    Policy public currentPolicy;
    /// @notice setPolicy 호출마다 1씩 증가. 이전 정책에서 보류된 요청은 승인할 수 없다.
    uint256 public policyVersion;
    /// @notice 현재 정책 기간 동안 실제 송금된 누적액 (예산 비교 기준)
    uint256 public policySpent;

    /// @notice 승인·차단 전체 타임라인
    AuditRecord[] public auditLogs;
    /// @notice 사용된 requestId (중복 요청·재전송 방지)
    mapping(uint256 => bool) public requestIdUsed;
    /// @notice 사용자 승인 대기 중인 요청
    mapping(uint256 => PendingRequest) public pendingRequests;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PolicyUpdated(uint256 indexed version, uint256 budget, uint256 deadline, bool requireHumanApproval);
    event MerchantUpdated(address indexed merchant, bool allowed);
    event AiAgentUpdated(address indexed previousAgent, address indexed newAgent);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event Deposited(address indexed from, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed to, uint256 amount);
    /// @notice 모든 감사 기록 추가 시 발생 (오프체인 인덱싱용)
    event AuditRecorded(
        uint256 indexed logIndex,
        uint256 indexed requestId,
        address indexed merchant,
        uint256 amount,
        bool isApproved,
        string reason
    );
    event SpendExecuted(uint256 indexed requestId, address indexed merchant, uint256 amount);
    event EmergencyPaused(address indexed by);
    event EmergencyResumed(address indexed by);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error NotAiAgent(address caller);
    error NotOwnerOrGuardian(address caller);
    error AgentMustNotBeOwner();
    error DuplicateRequestId(uint256 requestId);
    error RequestNotPending(uint256 requestId);
    error InsufficientBalance(uint256 requested, uint256 available);
    error OwnershipRenounceDisabled();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @param _aiAgent AI 에이전트(백엔드) 주소. 오너와 달라야 한다 (AI 자기 승인 방지).
     * @param _guardian 긴급 중지 권한만 가진 가디언 주소 (없으면 address(0))
     * @dev 배포자가 오너(사용자)가 된다.
     */
    constructor(address _aiAgent, address _guardian) Ownable(msg.sender) {
        if (_aiAgent == address(0)) revert ZeroAddress();
        if (_aiAgent == msg.sender) revert AgentMustNotBeOwner();
        aiAgent = _aiAgent;
        guardian = _guardian;
        emit AiAgentUpdated(address(0), _aiAgent);
        emit GuardianUpdated(address(0), _guardian);
    }

    // ---------------------------------------------------------------------
    // Owner: policy & merchants
    // ---------------------------------------------------------------------

    /**
     * @notice 새 지출 정책을 설정한다. 누적 지출액이 0 으로 초기화되고,
     *         이전 정책에서 보류된 요청은 더 이상 승인할 수 없다.
     */
    function setPolicy(uint256 budget, uint256 deadline, bool requireHumanApproval) external onlyOwner {
        currentPolicy = Policy(budget, deadline, requireHumanApproval);
        policySpent = 0;
        policyVersion += 1;
        emit PolicyUpdated(policyVersion, budget, deadline, requireHumanApproval);
    }

    function setMerchant(address merchant, bool allowed) external onlyOwner {
        if (merchant == address(0)) revert ZeroAddress();
        approvedMerchants[merchant] = allowed;
        emit MerchantUpdated(merchant, allowed);
    }

    function setAiAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        if (newAgent == owner()) revert AgentMustNotBeOwner();
        emit AiAgentUpdated(aiAgent, newAgent);
        aiAgent = newAgent;
    }

    /// @notice 가디언 변경 (address(0) 이면 가디언 없음)
    function setGuardian(address newGuardian) external onlyOwner {
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    /// @dev 소유권을 AI 에이전트에게 넘기면 AI 가 스스로 승인할 수 있으므로 막는다.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == aiAgent) revert AgentMustNotBeOwner();
        super.transferOwnership(newOwner);
    }

    // ---------------------------------------------------------------------
    // Funds
    // ---------------------------------------------------------------------

    /// @notice 금고 잔고를 충전한다.
    function deposit() external payable {
        _deposit();
    }

    receive() external payable {
        _deposit();
    }

    function _deposit() private {
        if (msg.value == 0) revert ZeroAmount();
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    /// @notice 오너가 금고 잔고를 회수한다 (데모 종료 후 테스트 자금 회수 등).
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        emit Withdrawn(to, amount);
        Address.sendValue(to, amount);
    }

    // ---------------------------------------------------------------------
    // AI agent: spend request
    // ---------------------------------------------------------------------

    /**
     * @notice AI 에이전트의 결제 요청. 정책 판정 결과를 감사 기록에 남긴다.
     * @dev 검사 순서: 긴급중지 → 기한 → 판매자 → 예산(누적) → 잔고.
     *      위반 시 revert 하지 않고 차단 기록만 남긴 뒤 false 를 반환한다.
     * @param merchant 판매자 주소
     * @param amount 상품 가격 + 수수료 합계
     * @param requestId 오프체인 요청 ID (백엔드 감사 로그와 연결하는 키, 재사용 불가)
     * @return executed 이번 호출에서 송금까지 완료되었으면 true
     */
    function requestSpend(address payable merchant, uint256 amount, uint256 requestId)
        external
        nonReentrant
        returns (bool executed)
    {
        if (msg.sender != aiAgent) revert NotAiAgent(msg.sender);
        if (merchant == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (requestIdUsed[requestId]) revert DuplicateRequestId(requestId);
        requestIdUsed[requestId] = true;

        string memory violation = _checkPolicy(merchant, amount);
        if (bytes(violation).length != 0) {
            _record(requestId, merchant, amount, false, violation);
            return false;
        }

        if (currentPolicy.requireHumanApproval) {
            pendingRequests[requestId] = PendingRequest(merchant, amount, policyVersion, true);
            _record(requestId, merchant, amount, false, REASON_PENDING);
            return false;
        }

        _execute(requestId, merchant, amount);
        return true;
    }

    // ---------------------------------------------------------------------
    // Owner (human): approval
    // ---------------------------------------------------------------------

    /**
     * @notice 사용자가 보류 중인 결제를 최종 승인한다. 승인 시점에 정책을 다시 검사한 뒤 송금한다.
     * @return executed 송금까지 완료되었으면 true (재검사에서 차단되면 false, 차단 기록이 남음)
     */
    function approveSpend(uint256 requestId) external onlyOwner nonReentrant whenNotPaused returns (bool executed) {
        PendingRequest memory req = pendingRequests[requestId];
        if (!req.exists) revert RequestNotPending(requestId);
        delete pendingRequests[requestId];

        if (req.policyVersion != policyVersion) {
            _record(requestId, req.merchant, req.amount, false, REASON_POLICY_CHANGED);
            return false;
        }
        string memory violation = _checkPolicy(req.merchant, req.amount);
        if (bytes(violation).length != 0) {
            _record(requestId, req.merchant, req.amount, false, violation);
            return false;
        }

        _execute(requestId, req.merchant, req.amount);
        return true;
    }

    /// @notice 사용자가 보류 중인 결제를 거절한다.
    function rejectSpend(uint256 requestId) external onlyOwner {
        PendingRequest memory req = pendingRequests[requestId];
        if (!req.exists) revert RequestNotPending(requestId);
        delete pendingRequests[requestId];
        _record(requestId, req.merchant, req.amount, false, REASON_REJECTED);
    }

    // ---------------------------------------------------------------------
    // Emergency stop
    // ---------------------------------------------------------------------

    /// @notice 긴급 중지 (오너 또는 가디언). 이후 AI 요청은 모두 "Emergency Paused" 로 차단 기록되고 승인도 불가하다.
    function emergencyPause() external {
        if (msg.sender != owner() && (guardian == address(0) || msg.sender != guardian)) {
            revert NotOwnerOrGuardian(msg.sender);
        }
        _pause();
        emit EmergencyPaused(msg.sender);
    }

    /// @notice 긴급 중지 해제.
    function unpauseVault() external onlyOwner {
        _unpause();
        emit EmergencyResumed(msg.sender);
    }

    /// @dev 오너가 사라지면 승인·긴급중지 해제가 영구히 불가능하므로 막는다.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenounceDisabled();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice 프론트엔드 타임라인용 전체 감사 기록.
    function getAuditLogs() external view returns (AuditRecord[] memory) {
        return auditLogs;
    }

    /// @notice 감사 기록 개수.
    function auditLogCount() external view returns (uint256) {
        return auditLogs.length;
    }

    /// @notice 감사 기록 구간 조회 (기록이 많아졌을 때 RPC 응답 크기 제한 회피용).
    function getAuditLogsRange(uint256 offset, uint256 limit) external view returns (AuditRecord[] memory page) {
        uint256 total = auditLogs.length;
        if (offset >= total) return new AuditRecord[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new AuditRecord[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = auditLogs[i];
        }
    }

    /// @notice 현재 정책에서 추가로 지출 가능한 금액.
    function remainingBudget() external view returns (uint256) {
        return currentPolicy.budget > policySpent ? currentPolicy.budget - policySpent : 0;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev 위반 사유 문자열을 반환한다. 통과하면 빈 문자열.
    function _checkPolicy(address merchant, uint256 amount) private view returns (string memory) {
        if (paused()) return REASON_EMERGENCY_PAUSED;
        if (block.timestamp > currentPolicy.deadline) return REASON_POLICY_EXPIRED;
        if (!approvedMerchants[merchant]) return REASON_UNREGISTERED_MERCHANT;
        if (policySpent + amount > currentPolicy.budget) return REASON_EXCEEDED_BUDGET;
        if (amount > address(this).balance) return REASON_INSUFFICIENT_BALANCE;
        return "";
    }

    function _execute(uint256 requestId, address payable merchant, uint256 amount) private {
        policySpent += amount;
        _record(requestId, merchant, amount, true, REASON_APPROVED);
        emit SpendExecuted(requestId, merchant, amount);
        Address.sendValue(merchant, amount);
    }

    function _record(uint256 requestId, address merchant, uint256 amount, bool isApproved, string memory reason)
        private
    {
        auditLogs.push(AuditRecord(requestId, merchant, amount, isApproved, reason, block.timestamp));
        emit AuditRecorded(auditLogs.length - 1, requestId, merchant, amount, isApproved, reason);
    }
}
