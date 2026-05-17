// test/voting_test.js
// ============================================================
//  Voting 컨트랙트 테스트 스위트
//  실행 방법: truffle test
//  테스트 프레임워크: Mocha (내장) + assert (Node.js 내장)
// ============================================================

const Voting = artifacts.require("Voting");

// ──────────────────────────────────────────────────────────
//  헬퍼: 트랜잭션이 revert 되는지 검증하는 유틸리티 함수
//  Truffle 5.x 기본 환경에서 외부 라이브러리 없이 동작
// ──────────────────────────────────────────────────────────
async function expectRevert(promise, expectedMessage) {
  try {
    await promise;
    // 여기까지 실행되면 revert가 안 된 것 → 테스트 실패
    assert.fail("트랜잭션이 revert되어야 하는데 성공했습니다");
  } catch (error) {
    // "revert" 키워드 또는 예상 메시지가 에러에 포함되어야 함
    const hasRevert = error.message.includes("revert");
    const hasMessage = expectedMessage
      ? error.message.includes(expectedMessage)
      : true;
    assert(
      hasRevert || hasMessage,
      `예상치 못한 에러: ${error.message}`
    );
  }
}

// ──────────────────────────────────────────────────────────
//  contract(): Truffle이 제공하는 테스트 블록
//  - describe()와 동일하게 동작하지만, 매 실행마다
//    accounts 배열(Ganache 계정 목록)을 자동으로 주입해줌
//  - 각 contract() 블록 실행 전에 컨트랙트를 새로 배포하지 않음
//    → beforeEach에서 직접 배포해야 독립성이 보장됨
// ──────────────────────────────────────────────────────────
contract("Voting", (accounts) => {

  // 역할 명시: 어떤 계정이 어떤 역할을 하는지 변수로 선언
  const owner    = accounts[0]; // 컨트랙트 배포자 = 관리자
  const voter1   = accounts[1]; // 일반 투표자 1
  const voter2   = accounts[2]; // 일반 투표자 2
  const voter3   = accounts[3]; // 일반 투표자 3
  const nonOwner = accounts[4]; // 관리자가 아닌 계정 (권한 테스트용)

  // 테스트용 초기 후보자 목록
  const initialCandidates = ["강원모", "박지훈", "김재원", "안건호", "엄성현"];

  // 각 테스트마다 신선한 컨트랙트 인스턴스 사용
  let voting;
  beforeEach(async () => {
    voting = await Voting.new(initialCandidates, { from: owner });
    //                ↑ .deployed() 는 마이그레이션 주소를 재사용함
    //                  .new() 는 테스트마다 완전히 새 컨트랙트를 배포함
    //                  → 테스트 간 상태 간섭 완전 차단
  });

  // ══════════════════════════════════════════════════════
  //  [1] 배포 및 초기 상태 검증
  // ══════════════════════════════════════════════════════
  describe("[1] 배포 및 초기 상태 검증", () => {

    it("배포자(owner)가 올바르게 설정되어야 한다", async () => {
      const contractOwner = await voting.owner();
      assert.strictEqual(
        contractOwner,
        owner,
        "owner가 배포자 주소와 다릅니다"
      );
    });

    it("배포 직후 투표가 열려 있어야 한다 (votingOpen = true)", async () => {
      const isOpen = await voting.votingOpen();
      assert.strictEqual(isOpen, true, "배포 후 투표가 열려있지 않습니다");
    });

    it("후보자 수(candidatesCount)가 초기 배열 길이와 같아야 한다", async () => {
      const count = await voting.candidatesCount();
      assert.strictEqual(
        count.toNumber(),
        initialCandidates.length,
        `후보자 수가 ${initialCandidates.length}명이어야 합니다`
      );
    });

    it("모든 후보자 이름이 올바르게 저장되어야 한다", async () => {
      const allCandidates = await voting.getAllCandidates();
      assert.strictEqual(
        allCandidates.length,
        initialCandidates.length,
        "반환된 후보자 수가 다릅니다"
      );

      for (let i = 0; i < initialCandidates.length; i++) {
        assert.strictEqual(
          allCandidates[i].name,
          initialCandidates[i],
          `${i + 1}번 후보자 이름이 다릅니다`
        );
        // id는 1번부터 시작
        assert.strictEqual(
          Number(allCandidates[i].id),
          i + 1,
          `${i + 1}번 후보자 ID가 다릅니다`
        );
        assert.strictEqual(
          Number(allCandidates[i].voteCount),
          0,
          `${i + 1}번 후보자의 초기 득표수가 0이 아닙니다`
        );
      }
    });
  });

  // ══════════════════════════════════════════════════════
  //  [2] 투표 기능 핵심 테스트
  // ══════════════════════════════════════════════════════
  describe("[2] 투표 기능 (vote)", () => {

    it("유효한 후보자에게 투표하면 득표수가 1 증가해야 한다", async () => {
      const candidateId = 1; // 강원모

      // 투표 전 득표수 확인
      const before = await voting.getCandidate(candidateId);
      const beforeCount = before[2].toNumber(); // voteCount

      await voting.vote(candidateId, { from: voter1 });

      // 투표 후 득표수 확인
      const after = await voting.getCandidate(candidateId);
      const afterCount = after[2].toNumber();

      assert.strictEqual(
        afterCount,
        beforeCount + 1,
        "투표 후 득표수가 1 증가하지 않았습니다"
      );
    });

    it("투표 후 해당 주소의 hasVoted가 true가 되어야 한다", async () => {
      // 투표 전: false
      const before = await voting.checkIfVoted(voter1);
      assert.strictEqual(before, false, "투표 전에 hasVoted가 true입니다");

      await voting.vote(1, { from: voter1 });

      // 투표 후: true
      const after = await voting.checkIfVoted(voter1);
      assert.strictEqual(after, true, "투표 후에 hasVoted가 false입니다");
    });

    it("투표 시 Voted 이벤트가 발생해야 한다", async () => {
      const candidateId = 2;
      const tx = await voting.vote(candidateId, { from: voter1 });

      // 트랜잭션 로그에서 이벤트 확인
      const event = tx.logs.find((log) => log.event === "Voted");
      assert.ok(event, "Voted 이벤트가 발생하지 않았습니다");
      assert.strictEqual(
        event.args.voter.toLowerCase(),
        voter1.toLowerCase(),
        "이벤트의 voter 주소가 다릅니다"
      );
      assert.strictEqual(
        event.args.candidateId.toNumber(),
        candidateId,
        "이벤트의 candidateId가 다릅니다"
      );
    });

    it("여러 사람이 각자 다른 후보에게 투표할 수 있어야 한다", async () => {
      await voting.vote(1, { from: voter1 });
      await voting.vote(2, { from: voter2 });
      await voting.vote(1, { from: voter3 });

      const cand1 = await voting.getCandidate(1);
      const cand2 = await voting.getCandidate(2);

      assert.strictEqual(cand1[2].toNumber(), 2, "1번 후보 득표수가 2여야 합니다");
      assert.strictEqual(cand2[2].toNumber(), 1, "2번 후보 득표수가 1이어야 합니다");
    });

    // ── 중복 투표 방지 (핵심 보안 기능) ──
    it("[보안] 같은 주소로 두 번 투표하면 revert되어야 한다", async () => {
      await voting.vote(1, { from: voter1 }); // 첫 번째 투표: 성공
      await expectRevert(
        voting.vote(2, { from: voter1 }), // 두 번째 투표: 실패해야 함
        "You have already voted"
      );
    });

    // ── 유효하지 않은 후보자 ID ──
    it("[보안] 후보자 ID가 0이면 revert되어야 한다", async () => {
      await expectRevert(
        voting.vote(0, { from: voter1 }),
        "Invalid candidate ID"
      );
    });

    it("[보안] 후보자 ID가 범위를 초과하면 revert되어야 한다", async () => {
      const tooLarge = initialCandidates.length + 1; // 6번 (존재하지 않음)
      await expectRevert(
        voting.vote(tooLarge, { from: voter1 }),
        "Invalid candidate ID"
      );
    });

    // ── 투표 기간 외 차단 ──
    it("[보안] 투표가 닫혀있으면 revert되어야 한다", async () => {
      await voting.closeVoting({ from: owner }); // 투표 종료
      await expectRevert(
        voting.vote(1, { from: voter1 }),
        "Voting is not open"
      );
    });
  });

  // ══════════════════════════════════════════════════════
  //  [3] 후보자 추가 (addCandidate)
  // ══════════════════════════════════════════════════════
  describe("[3] 후보자 추가 (addCandidate)", () => {

    it("owner는 새 후보자를 추가할 수 있어야 한다", async () => {
      const beforeCount = (await voting.candidatesCount()).toNumber();
      const tx = await voting.addCandidate("홍길동", { from: owner });

      const afterCount = (await voting.candidatesCount()).toNumber();
      assert.strictEqual(afterCount, beforeCount + 1, "후보자 수가 증가하지 않았습니다");

      // 이벤트도 확인
      const event = tx.logs.find((log) => log.event === "CandidateAdded");
      assert.ok(event, "CandidateAdded 이벤트가 없습니다");
      assert.strictEqual(event.args.name, "홍길동");
    });

    it("[보안] owner가 아닌 계정이 후보자를 추가하면 revert되어야 한다", async () => {
      await expectRevert(
        voting.addCandidate("무단추가자", { from: nonOwner }),
        "Only owner can call this function"
      );
    });

    it("[보안] 빈 문자열 이름으로 후보자를 추가하면 revert되어야 한다", async () => {
      await expectRevert(
        voting.addCandidate("", { from: owner }),
        "Candidate name cannot be empty"
      );
    });
  });

  // ══════════════════════════════════════════════════════
  //  [4] 투표 개폐 관리 (openVoting / closeVoting)
  // ══════════════════════════════════════════════════════
  describe("[4] 투표 개폐 관리", () => {

    it("owner는 투표를 닫을 수 있어야 한다", async () => {
      await voting.closeVoting({ from: owner });
      const isOpen = await voting.votingOpen();
      assert.strictEqual(isOpen, false, "closeVoting 후에도 votingOpen이 true입니다");
    });

    it("owner는 닫힌 투표를 다시 열 수 있어야 한다", async () => {
      await voting.closeVoting({ from: owner });
      await voting.openVoting({ from: owner });
      const isOpen = await voting.votingOpen();
      assert.strictEqual(isOpen, true, "openVoting 후에도 votingOpen이 false입니다");
    });

    it("[보안] owner가 아닌 계정은 투표를 닫을 수 없어야 한다", async () => {
      await expectRevert(
        voting.closeVoting({ from: nonOwner }),
        "Only owner can call this function"
      );
    });

    it("[보안] 이미 닫힌 투표를 다시 닫으려 하면 revert되어야 한다", async () => {
      await voting.closeVoting({ from: owner });
      await expectRevert(
        voting.closeVoting({ from: owner }),
        "Voting is already closed"
      );
    });

    it("[보안] 이미 열린 투표를 다시 열려 하면 revert되어야 한다", async () => {
      await expectRevert(
        voting.openVoting({ from: owner }),
        "Voting is already open"
      );
    });
  });

  // ══════════════════════════════════════════════════════
  //  [5] 조회 함수 (getCandidate / getAllCandidates / checkIfVoted)
  // ══════════════════════════════════════════════════════
  describe("[5] 조회 함수 (view)", () => {

    it("getCandidate()로 특정 후보자 정보를 정확히 조회해야 한다", async () => {
      const result = await voting.getCandidate(3); // 김재원
      assert.strictEqual(result[0].toNumber(), 3,       "id가 다릅니다");
      assert.strictEqual(result[1],            "김재원", "name이 다릅니다");
      assert.strictEqual(result[2].toNumber(), 0,       "초기 voteCount가 0이어야 합니다");
    });

    it("[보안] 유효하지 않은 ID로 getCandidate() 호출 시 revert되어야 한다", async () => {
      await expectRevert(
        voting.getCandidate(0),
        "Invalid candidate ID"
      );
      await expectRevert(
        voting.getCandidate(99),
        "Invalid candidate ID"
      );
    });

    it("getAllCandidates()는 투표 후에도 정확한 득표수를 반환해야 한다", async () => {
      // voter1 → 1번, voter2 → 1번, voter3 → 5번
      await voting.vote(1, { from: voter1 });
      await voting.vote(1, { from: voter2 });
      await voting.vote(5, { from: voter3 });

      const all = await voting.getAllCandidates();
      assert.strictEqual(Number(all[0].voteCount), 2, "1번 후보 득표수가 2여야 합니다");
      assert.strictEqual(Number(all[4].voteCount), 1, "5번 후보 득표수가 1이어야 합니다");
    });

    it("checkIfVoted()는 투표 전 false, 후 true를 반환해야 한다", async () => {
      assert.strictEqual(await voting.checkIfVoted(voter2), false);
      await voting.vote(4, { from: voter2 });
      assert.strictEqual(await voting.checkIfVoted(voter2), true);
    });
  });

  // ══════════════════════════════════════════════════════
  //  [6] 시나리오 통합 테스트
  //      실제 투표 진행 흐름 전체를 순서대로 검증
  // ══════════════════════════════════════════════════════
  describe("[6] 통합 시나리오: 투표 전체 흐름", () => {

    it("전체 투표 시나리오: 투표 → 중간 집계 → 종료 → 최종 결과", async () => {
      // [1단계] 5명 전원 투표 (1번 2표, 3번 2표, 5번 1표)
      await voting.vote(1, { from: voter1 });
      await voting.vote(3, { from: voter2 });
      await voting.vote(1, { from: voter3 });
      await voting.vote(3, { from: nonOwner });
      await voting.vote(5, { from: accounts[5] });

      // [2단계] 투표 종료
      await voting.closeVoting({ from: owner });
      assert.strictEqual(await voting.votingOpen(), false);

      // [3단계] 종료 후 추가 투표 시도 → 실패해야 함
      await expectRevert(
        voting.vote(1, { from: accounts[6] }),
        "Voting is not open"
      );

      // [4단계] 최종 결과 확인
      const results = await voting.getAllCandidates();
      assert.strictEqual(Number(results[0].voteCount), 2, "강원모: 2표");
      assert.strictEqual(Number(results[1].voteCount), 0, "박지훈: 0표");
      assert.strictEqual(Number(results[2].voteCount), 2, "김재원: 2표");
      assert.strictEqual(Number(results[3].voteCount), 0, "안건호: 0표");
      assert.strictEqual(Number(results[4].voteCount), 1, "엄성현: 1표");


      
    it("배포자(owner)도 후보자에게 투표할 수 있어야 한다", async () => {
      await voting.vote(1, { from: owner });
      const cand = await voting.getCandidate(1);
      // Number() 사용으로 통일
      assert.strictEqual(Number(cand.voteCount), 1, "owner의 투표가 반영되지 않았습니다");
      });
    });
  });
});