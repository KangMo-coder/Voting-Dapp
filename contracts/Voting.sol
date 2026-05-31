// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  Voting.sol — 투명한 대학/동아리 투표 스마트 컨트랙트 v2
//
//  v1 → v2 변경 사항 요약:
//  1. [NEW] 화이트리스트 기반 오프체인 신원 검증
//     - mapping(address => bool) whitelist
//     - addVoter / addVoters / removeVoter 함수 추가
//     - onlyWhitelisted 수정자 추가 → vote()에 적용
//
//  2. [MODIFIED] vote() 함수
//     - onlyWhitelisted 수정자 추가 (한 줄 변경)
//
//  3. [NEW] 당선자 자동 선언
//     - winnerCandidateId / winnerDeclared 상태 변수 추가
//     - _declareWinner() 내부 함수 추가
//     - closeVoting() 호출 시 자동으로 당선자 계산
//     - getWinner() 조회 함수 추가
//     - WinnerDeclared 이벤트 추가
//
//  4. [NEW] 이벤트 기반 실시간 UI 지원
//     - VoterAdded / VoterRemoved 이벤트 추가
//     - (프론트엔드 app.js에서 이벤트 구독 가능)
// ============================================================

contract Voting {

    // --------------------------------------------------------
    //  [1] 데이터 구조 정의
    //  변경 없음
    // --------------------------------------------------------

    struct Candidate {
        uint256 id;          // 후보자 고유 번호 (1번부터 시작)
        string  name;        // 후보자 이름
        uint256 voteCount;   // 현재까지 받은 득표 수
    }

    // --------------------------------------------------------
    //  [2] 상태 변수 선언 (블록체인에 영구 저장되는 데이터)
    //  [NEW] whitelist, winnerCandidateId, winnerDeclared 추가
    // --------------------------------------------------------

    // 컨트랙트를 배포한 관리자 주소
    address public owner;

    // 후보자 목록: id → Candidate 구조체로 매핑
    mapping(uint256 => Candidate) public candidates;

    // 총 후보자 수
    uint256 public candidatesCount;

    // 투표 여부 추적: 지갑 주소 → 투표했는지 (중복 투표 방지 핵심)
    mapping(address => bool) public hasVoted;

    // 투표 기간 제어
    bool public votingOpen;

    // [NEW] 화이트리스트: 관리자가 투표 권한을 부여한 지갑 주소 목록
    // 오프체인에서 학번/신원을 검증한 뒤, 해당 지갑 주소를 여기에 등록
    // whitelist[주소] = true  → 투표 가능
    // whitelist[주소] = false → 투표 불가 (기본값)
    mapping(address => bool) public whitelist;

    // [NEW] 공식 당선자 ID (closeVoting() 호출 시 자동 설정, 0 = 미선정)
    uint256 public winnerCandidateId;

    // [NEW] 당선자가 공식 선언됐는지 여부
    // false = 투표 진행 중 / true = 투표 종료 후 공식 확정
    bool public winnerDeclared;

    // --------------------------------------------------------
    //  [3] 이벤트 선언
    //  [NEW] VoterAdded, VoterRemoved, WinnerDeclared 추가
    // --------------------------------------------------------

    // 후보자가 추가됐을 때 발생
    event CandidateAdded(uint256 indexed candidateId, string name);

    // 투표가 완료됐을 때 발생
    // 프론트엔드에서 이 이벤트를 구독 → 누군가 투표하면 UI 자동 갱신
    event Voted(address indexed voter, uint256 indexed candidateId);

    // [NEW] 유권자가 화이트리스트에 등록됐을 때 발생
    event VoterAdded(address indexed voter);

    // [NEW] 유권자가 화이트리스트에서 제거됐을 때 발생
    event VoterRemoved(address indexed voter);

    // [NEW] 투표 종료 시 당선자가 확정됐을 때 발생
    // 프론트엔드에서 이 이벤트를 구독 → 투표 종료 즉시 당선자 UI 표시
    event WinnerDeclared(
        uint256 indexed candidateId,
        string name,
        uint256 voteCount
    );

    // --------------------------------------------------------
    //  [4] 수정자 (Modifier)
    //  [NEW] onlyWhitelisted 추가
    // --------------------------------------------------------

    // 오직 컨트랙트 배포자(owner)만 호출 가능
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    // 투표가 열려 있을 때만 실행 가능
    modifier whenVotingOpen() {
        require(votingOpen, "Voting is not open");
        _;
    }

    // [NEW] 화이트리스트에 등록된 주소만 통과
    // vote() 함수에 적용 → 미등록 지갑은 트랜잭션 자체가 revert됨
    modifier onlyWhitelisted() {
        require(
            whitelist[msg.sender],
            "Not authorized: contact admin to register your wallet"
        );
        _;
    }

    // --------------------------------------------------------
    //  [5] 생성자
    //  변경 없음
    // --------------------------------------------------------

    constructor(string[] memory candidateNames) {
        owner = msg.sender;
        votingOpen = true;
        for (uint256 i = 0; i < candidateNames.length; i++) {
            _addCandidate(candidateNames[i]);
        }
    }

    // --------------------------------------------------------
    //  [6] 핵심 함수들
    //  [MODIFIED] vote()에 onlyWhitelisted 수정자 추가 (한 줄 변경)
    // --------------------------------------------------------

    // [6-1] 후보자 등록 (내부 전용)
    function _addCandidate(string memory name) internal {
        require(bytes(name).length > 0, "Candidate name cannot be empty");
        candidatesCount++;
        candidates[candidatesCount] = Candidate({
            id:        candidatesCount,
            name:      name,
            voteCount: 0
        });
        emit CandidateAdded(candidatesCount, name);
    }

    // [6-2] 외부에서 후보자 추가 (owner만 가능)
    function addCandidate(string memory name) public onlyOwner {
        _addCandidate(name);
    }

    // [6-3] 투표 함수
    // [MODIFIED] whenVotingOpen 뒤에 onlyWhitelisted 수정자 추가
    // 실행 순서: whenVotingOpen 검사 → onlyWhitelisted 검사 → 함수 본문
    function vote(uint256 candidateId) public whenVotingOpen onlyWhitelisted {

        // 조건 1: 중복 투표 방지
        require(!hasVoted[msg.sender], "You have already voted");

        // 조건 2: 유효한 후보자 번호 확인
        require(
            candidateId > 0 && candidateId <= candidatesCount,
            "Invalid candidate ID"
        );

        // 투표 처리
        hasVoted[msg.sender] = true;
        candidates[candidateId].voteCount++;

        // 이벤트 발생 → 프론트엔드 실시간 UI 갱신 트리거
        emit Voted(msg.sender, candidateId);
    }

    // --------------------------------------------------------
    //  [6-NEW] 화이트리스트 관리 함수
    //  오프체인 신원 검증 후 관리자가 이 함수들로 등록/제거
    // --------------------------------------------------------

    // 유권자 1명 등록 (내부 helper)
    function _addVoter(address voter) internal {
        // address(0) = 유효하지 않은 주소 (0x000...000)
        require(voter != address(0), "Invalid address");
        require(!whitelist[voter], "Already whitelisted");
        whitelist[voter] = true;
        emit VoterAdded(voter);
    }

    // 유권자 1명 등록 (관리자 전용)
    // 사용 예: 학생이 지갑 주소를 제출 → 관리자가 학번 확인 후 이 함수 호출
    function addVoter(address voter) public onlyOwner {
        _addVoter(voter);
    }

    // 유권자 여러 명 한 번에 등록 (배치 처리)
    // 사용 예: 동아리 회원 전체를 주소 배열로 한 번에 등록
    // ["0xABC...", "0xDEF...", ...] 형태로 전달
    function addVoters(address[] memory voters) public onlyOwner {
        for (uint256 i = 0; i < voters.length; i++) {
            _addVoter(voters[i]);
        }
    }

    // 유권자 등록 취소 (실수 수정 또는 자격 박탈 시)
    function removeVoter(address voter) public onlyOwner {
        require(whitelist[voter], "Address is not whitelisted");
        whitelist[voter] = false;
        emit VoterRemoved(voter);
    }

    // --------------------------------------------------------
    //  [7] 조회 함수 (view) — 가스비 없음
    //  [NEW] getWinner() 추가
    // --------------------------------------------------------

    // 특정 후보자 정보 반환
    function getCandidate(uint256 candidateId)
        public
        view
        returns (uint256 id, string memory name, uint256 voteCount)
    {
        require(
            candidateId > 0 && candidateId <= candidatesCount,
            "Invalid candidate ID"
        );
        Candidate storage c = candidates[candidateId];
        return (c.id, c.name, c.voteCount);
    }

    // 전체 후보자 목록 반환
    function getAllCandidates()
        public
        view
        returns (Candidate[] memory)
    {
        Candidate[] memory allCandidates = new Candidate[](candidatesCount);
        for (uint256 i = 1; i <= candidatesCount; i++) {
            allCandidates[i - 1] = candidates[i];
        }
        return allCandidates;
    }

    // 특정 주소의 투표 여부 확인
    function checkIfVoted(address voter) public view returns (bool) {
        return hasVoted[voter];
    }

    // 특정 주소의 화이트리스트 등록 여부 확인 (프론트엔드용)
    function isWhitelisted(address voter) public view returns (bool) {
        return whitelist[voter];
    }

    // [NEW] 현재 1위 후보자 반환
    // 투표 진행 중: 현재 득표 1위 (비공식)
    // 투표 종료 후: 공식 당선자 (isOfficial = true)
    //
    // 반환값:
    // - id        : 후보자 번호
    // - name      : 후보자 이름
    // - voteCount : 득표 수
    // - isTied    : 공동 1위 여부 (true면 동점 상황)
    // - isOfficial: 공식 선언 여부 (closeVoting() 후 true)
    function getWinner()
        public
        view
        returns (
            uint256 id,
            string memory name,
            uint256 voteCount,
            bool isTied,
            bool isOfficial
        )
    {
        require(candidatesCount > 0, "No candidates registered");

        uint256 maxVotes = 0;
        uint256 leaderId = 0;
        bool tied = false;

        // 전체 후보자를 순회하며 최다 득표자 탐색
        for (uint256 i = 1; i <= candidatesCount; i++) {
            if (candidates[i].voteCount > maxVotes) {
                // 새로운 최다 득표자 발견 → 동점 해제
                maxVotes = candidates[i].voteCount;
                leaderId = i;
                tied = false;
            } else if (candidates[i].voteCount == maxVotes && maxVotes > 0) {
                // 동점자 발견
                tied = true;
            }
        }

        // 아직 아무도 투표하지 않은 경우
        if (leaderId == 0) {
            return (0, "No votes cast yet", 0, false, false);
        }

        Candidate storage leader = candidates[leaderId];
        return (
            leader.id,
            leader.name,
            leader.voteCount,
            tied,
            winnerDeclared   // 공식 선언 여부
        );
    }

    // --------------------------------------------------------
    //  [8] 관리자 함수
    //  [MODIFIED] closeVoting() — 종료 시 당선자 자동 선언 추가
    // --------------------------------------------------------

    // [MODIFIED] 투표 종료 + 당선자 자동 선언
    // v1과 달리 votingOpen = false 후 _declareWinner() 호출
    function closeVoting() public onlyOwner {
        require(votingOpen, "Voting is already closed");
        votingOpen = false;

        // [NEW] 투표 종료와 동시에 당선자 계산 및 이벤트 발생
        _declareWinner();
    }

    // [NEW] 당선자 계산 내부 함수
    // closeVoting()에서만 호출됨 (internal)
    // 최다 득표자를 winnerCandidateId에 저장하고 WinnerDeclared 이벤트 발생
    // 동점 시: 후보자 번호가 낮은(먼저 등록된) 후보자가 당선
    function _declareWinner() internal {
        if (candidatesCount == 0) return;

        uint256 maxVotes = 0;
        uint256 winnerId = 0;

        for (uint256 i = 1; i <= candidatesCount; i++) {
            // 엄격한 부등호(>)이므로 동점 시 먼저 등록된 후보자 유지
            if (candidates[i].voteCount > maxVotes) {
                maxVotes = candidates[i].voteCount;
                winnerId = i;
            }
        }

        // 최소 1표 이상 받은 당선자가 있을 때만 선언
        if (winnerId > 0 && maxVotes > 0) {
            winnerCandidateId = winnerId;
            winnerDeclared    = true;
            emit WinnerDeclared(
                winnerId,
                candidates[winnerId].name,
                maxVotes
            );
        }
    }

    // 투표 재개 (owner만 가능)
    function openVoting() public onlyOwner {
        require(!votingOpen, "Voting is already open");
        // 재개 시 당선자 선언 초기화
        winnerDeclared    = false;
        winnerCandidateId = 0;
        votingOpen        = true;
    }
}
