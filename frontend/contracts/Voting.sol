// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  Voting.sol — 투명한 대학/동아리 투표 스마트 컨트랙트
//  작성 원칙: 각 줄의 역할을 이해하며 직접 수정/확장할 것
// ============================================================

contract Voting {

    
    // --------------------------------------------------------
    //  [1] 데이터 구조 정의
    // --------------------------------------------------------

    // Candidate: 후보자 1명을 표현하는 구조체
    // 구조체는 여러 변수를 하나로 묶는 사용자 정의 타입
    struct Candidate {
        uint256 id;          // 후보자 고유 번호 (1번부터 시작)
        string  name;        // 후보자 이름
        uint256 voteCount;   // 현재까지 받은 득표 수
    }

    // --------------------------------------------------------
    //  [2] 상태 변수 선언 (블록체인에 영구 저장되는 데이터)
    // --------------------------------------------------------

    // 컨트랙트를 배포한 관리자 주소
    // 후보자 추가 등 관리 기능을 관리자만 쓸 수 있도록 제한할 때 사용
    address public owner;

    // 후보자 목록: id → Candidate 구조체로 매핑
    // mapping은 솔리디티의 해시맵(딕셔너리). 키 → 값 구조
    mapping(uint256 => Candidate) public candidates;

    // 총 후보자 수. 새 후보자 추가 시 id로도 활용
    uint256 public candidatesCount;

    // 투표 여부 추적: 지갑 주소 → 투표했는지(true/false)
    // 중복 투표 방지의 핵심 자료구조
    // 지갑 주소가 키(key)이므로 같은 주소로 두 번 투표 불가
    mapping(address => bool) public hasVoted;

    // 투표 기간 제어 (선택 고도화: 기간 외 투표 차단)
    bool public votingOpen;

    // --------------------------------------------------------
    //  [3] 이벤트 선언
    //      이벤트 = 트랜잭션 발생 시 블록체인 로그에 기록
    //      프론트엔드에서 이벤트를 구독(listen)해 실시간 UI 갱신 가능
    // --------------------------------------------------------

    // 후보자가 추가됐을 때 발생
    event CandidateAdded(uint256 indexed candidateId, string name);

    // 투표가 완료됐을 때 발생
    // indexed: 이 값으로 이벤트 필터링 가능 (예: 특정 후보에게 간 투표만 조회)
    event Voted(address indexed voter, uint256 indexed candidateId);

    // --------------------------------------------------------
    //  [4] 수정자 (Modifier)
    //      함수 실행 전 조건을 검사하는 재사용 가능한 코드 블록
    //      _; 위치에서 원래 함수 코드가 실행됨
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

    // --------------------------------------------------------
    //  [5] 생성자 (Constructor)
    //      컨트랙트 배포 시 딱 한 번 실행되는 초기화 함수
    //      배포할 때 후보자 이름 목록을 넘겨서 바로 등록
    // --------------------------------------------------------

    constructor(string[] memory candidateNames) {
        // 배포자 주소를 owner로 저장
        owner = msg.sender;

        // 투표를 즉시 오픈 상태로 시작
        votingOpen = true;

        // 전달받은 이름 배열을 순회하며 후보자 등록
        // addCandidate 내부 함수 재사용 (코드 중복 방지)
        for (uint256 i = 0; i < candidateNames.length; i++) {
            _addCandidate(candidateNames[i]);
        }
    }

    // --------------------------------------------------------
    //  [6] 핵심 함수들
    // --------------------------------------------------------

    // [6-1] 후보자 등록 (내부 전용 helper 함수)
    // internal: 이 컨트랙트 내부에서만 호출 가능 (외부 직접 호출 불가)
    function _addCandidate(string memory name) internal {
        require(bytes(name).length > 0, "Candidate name cannot be empty");
        // 후보자 수 1 증가 → 새 후보자의 id로 사용
        candidatesCount++;

        // mapping에 새 Candidate 구조체 저장
        candidates[candidatesCount] = Candidate({
            id:        candidatesCount,
            name:      name,
            voteCount: 0
        });

        // 이벤트 발생 → 블록체인 로그에 기록
        emit CandidateAdded(candidatesCount, name);
    }

    // [6-2] 외부에서 후보자 추가 (owner만 가능)
    // onlyOwner 수정자 → owner가 아니면 require에서 revert
    function addCandidate(string memory name) public onlyOwner {
        _addCandidate(name);
    }

    // [6-3] 투표 함수 — 이 프로젝트의 핵심
    // whenVotingOpen 수정자 → 투표 기간이 아니면 차단
    function vote(uint256 candidateId) public whenVotingOpen {

        // require: 조건이 false면 트랜잭션 전체를 revert (가스비 일부 반환)
        // 조건 1: 아직 투표하지 않은 주소인지 확인 (중복 투표 방지 핵심)
        require(!hasVoted[msg.sender], "You have already voted");

        // 조건 2: 유효한 후보자 번호인지 확인 (0번이나 범위 초과 방지)
        require(
            candidateId > 0 && candidateId <= candidatesCount,
            "Invalid candidate ID"
        );

        // 투표 처리 1: 이 지갑 주소를 "이미 투표함"으로 기록
        // 다음에 같은 주소로 vote() 호출하면 위 require에서 막힘
        hasVoted[msg.sender] = true;

        // 투표 처리 2: 해당 후보자의 득표수 1 증가
        candidates[candidateId].voteCount++;

        // 이벤트 발생 → 프론트엔드에서 이 이벤트를 수신해 UI 실시간 갱신
        emit Voted(msg.sender, candidateId);
    }

    // --------------------------------------------------------
    //  [7] 조회 함수 (view) — 블록체인 상태를 읽기만 함
    //      가스비 없음! 트랜잭션을 발생시키지 않음
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

    // 전체 후보자 목록 반환 (프론트엔드에서 목록 렌더링용)
    function getAllCandidates()
        public
        view
        returns (Candidate[] memory)
    {
        // 총 후보자 수만큼의 크기를 가진 구조체 배열 생성
        Candidate[] memory allCandidates = new Candidate[](candidatesCount);

        for (uint256 i = 1; i <= candidatesCount; i++) {
            // 인덱스는 0부터 시작하므로 i - 1
            allCandidates[i - 1] = candidates[i];
        }

        return allCandidates;
    }


    // 현재 지갑 주소가 이미 투표했는지 확인 (프론트에서 버튼 비활성화 용도)
    function checkIfVoted(address voter) public view returns (bool) {
        return hasVoted[voter];
    }

    // --------------------------------------------------------
    //  [8] 관리자 함수
    // --------------------------------------------------------

    // 투표 종료 (owner만 가능)
    function closeVoting() public onlyOwner {
        require(votingOpen, "Voting is already closed");
        votingOpen = false;
    }

    // 투표 재개 (owner만 가능)
    function openVoting() public onlyOwner {
        require(!votingOpen, "Voting is already open");
        votingOpen = true;
    }
}
