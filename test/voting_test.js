const Voting = artifacts.require("Voting");

contract("Voting", (accounts) => {

    const owner  = accounts[0];
    const voter1 = accounts[1];
    const voter2 = accounts[2];
    const voter3 = accounts[3];
    const hacker = accounts[4];
    const candidateNames = ["강원모", "박지훈", "김재원"];

    // ============================================================
    //  [1] 배포 및 초기 상태
    // ============================================================
    describe("[1] 배포 및 초기 상태", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
        });

        it("배포자가 owner로 설정되어야 한다", async () => {
            const contractOwner = await voting.owner();
            assert.strictEqual(contractOwner, owner);
        });

        it("배포 시 투표가 열려 있어야 한다", async () => {
            const isOpen = await voting.votingOpen();
            assert.strictEqual(isOpen, true);
        });

        it("배포 시 후보자 수가 3명이어야 한다", async () => {
            const count = await voting.candidatesCount();
            assert.strictEqual(Number(count), 3);
        });

        it("초기 winnerDeclared는 false여야 한다", async () => {
            const declared = await voting.winnerDeclared();
            assert.strictEqual(declared, false);
        });

        it("초기 winnerCandidateId는 0이어야 한다", async () => {
            const winnerId = await voting.winnerCandidateId();
            assert.strictEqual(Number(winnerId), 0);
        });
    });

    // ============================================================
    //  [2] 후보자 관리
    // ============================================================
    describe("[2] 후보자 관리", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
        });

        it("후보자 정보를 올바르게 조회할 수 있어야 한다", async () => {
            const result = await voting.getCandidate(1);
            assert.strictEqual(Number(result[0]), 1);
            assert.strictEqual(result[1], "강원모");
            assert.strictEqual(Number(result[2]), 0);
        });

        it("전체 후보자 목록을 조회할 수 있어야 한다", async () => {
            const candidates = await voting.getAllCandidates();
            assert.strictEqual(candidates.length, 3);
            assert.strictEqual(candidates[0].name, "강원모");
            assert.strictEqual(candidates[2].name, "김재원");
        });

        it("owner는 새 후보자를 추가할 수 있어야 한다", async () => {
            await voting.addCandidate("안건호", { from: owner });
            const count = await voting.candidatesCount();
            assert.strictEqual(Number(count), 4);
        });

        it("owner가 아닌 계정은 후보자를 추가할 수 없어야 한다", async () => {
            try {
                await voting.addCandidate("불법후보", { from: voter1 });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("빈 이름으로 후보자를 추가할 수 없어야 한다", async () => {
            try {
                await voting.addCandidate("", { from: owner });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("유효하지 않은 ID로 후보자 조회 시 예외가 발생해야 한다", async () => {
            try {
                await voting.getCandidate(99);
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });
    });

    // ============================================================
    //  [3] 화이트리스트 관리
    // ============================================================
    describe("[3] 화이트리스트 관리", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
        });

        it("초기에는 아무도 화이트리스트에 없어야 한다", async () => {
            const listed = await voting.isWhitelisted(voter1);
            assert.strictEqual(listed, false);
        });

        it("owner는 유권자를 화이트리스트에 등록할 수 있어야 한다", async () => {
            await voting.addVoter(voter1, { from: owner });
            const listed = await voting.isWhitelisted(voter1);
            assert.strictEqual(listed, true);
        });

        it("owner는 여러 유권자를 한 번에 등록할 수 있어야 한다", async () => {
            await voting.addVoters([voter2, voter3], { from: owner });
            const listed2 = await voting.isWhitelisted(voter2);
            const listed3 = await voting.isWhitelisted(voter3);
            assert.strictEqual(listed2, true);
            assert.strictEqual(listed3, true);
        });

        it("이미 등록된 주소를 다시 등록하면 예외가 발생해야 한다", async () => {
            try {
                await voting.addVoter(voter1, { from: owner });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("owner는 유권자를 화이트리스트에서 제거할 수 있어야 한다", async () => {
            await voting.removeVoter(voter3, { from: owner });
            const listed = await voting.isWhitelisted(voter3);
            assert.strictEqual(listed, false);
        });

        it("등록되지 않은 주소를 제거하면 예외가 발생해야 한다", async () => {
            try {
                await voting.removeVoter(hacker, { from: owner });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("owner가 아닌 계정은 유권자를 등록할 수 없어야 한다", async () => {
            try {
                await voting.addVoter(hacker, { from: voter1 });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });
    });

    // ============================================================
    //  [4] 투표 기능
    // ============================================================
    describe("[4] 투표 기능", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
            await voting.addVoter(voter1, { from: owner });
            await voting.addVoter(voter2, { from: owner });
        });

        it("화이트리스트에 등록된 유권자는 투표할 수 있어야 한다", async () => {
            await voting.vote(1, { from: voter1 });
            const cand = await voting.candidates(1);
            assert.strictEqual(Number(cand.voteCount), 1);
        });

        it("투표 후 해당 주소의 투표 여부가 true여야 한다", async () => {
            const voted = await voting.checkIfVoted(voter1);
            assert.strictEqual(voted, true);
        });

        it("투표하지 않은 주소의 투표 여부는 false여야 한다", async () => {
            const voted = await voting.checkIfVoted(voter2);
            assert.strictEqual(voted, false);
        });

        it("여러 후보자에게 득표가 올바르게 반영되어야 한다", async () => {
            await voting.vote(2, { from: voter2 });
            const cand1 = await voting.candidates(1);
            const cand2 = await voting.candidates(2);
            assert.strictEqual(Number(cand1.voteCount), 1);
            assert.strictEqual(Number(cand2.voteCount), 1);
        });
    });

    // ============================================================
    //  [5] 보안 및 예외 처리
    // ============================================================
    describe("[5] 보안 및 예외 처리", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
            await voting.addVoter(voter1, { from: owner });
            await voting.vote(1, { from: voter1 });
        });

        it("화이트리스트 미등록 계정은 투표할 수 없어야 한다 (v2 핵심)", async () => {
            try {
                await voting.vote(1, { from: hacker });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("중복 투표는 차단되어야 한다", async () => {
            try {
                await voting.vote(1, { from: voter1 });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("유효하지 않은 후보자 ID(0)로 투표 시 예외가 발생해야 한다", async () => {
            await voting.addVoter(voter2, { from: owner });
            try {
                await voting.vote(0, { from: voter2 });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("범위 초과 후보자 ID로 투표 시 예외가 발생해야 한다", async () => {
            try {
                await voting.vote(99, { from: voter2 });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });

        it("투표 종료 후에는 투표할 수 없어야 한다", async () => {
            await voting.closeVoting({ from: owner });
            await voting.addVoter(voter3, { from: owner });
            try {
                await voting.vote(1, { from: voter3 });
                assert.fail("예외가 발생해야 합니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }
        });
    });

    // ============================================================
    //  [6] 당선자 자동 선언
    // ============================================================
    describe("[6] 당선자 자동 선언", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
            await voting.addVoters([voter1, voter2, voter3], { from: owner });
            await voting.vote(1, { from: voter1 });
            await voting.vote(1, { from: voter2 });
            await voting.vote(2, { from: voter3 });
        });

        it("투표 종료 전 getWinner는 비공식 현재 1위를 반환해야 한다", async () => {
            const winner = await voting.getWinner();
            assert.strictEqual(Number(winner.id), 1);
            assert.strictEqual(winner.isOfficial, false);
        });

        it("투표 종료 시 winnerDeclared가 true로 설정되어야 한다", async () => {
            await voting.closeVoting({ from: owner });
            const declared = await voting.winnerDeclared();
            assert.strictEqual(declared, true);
        });

        it("winnerCandidateId가 올바르게 설정되어야 한다", async () => {
            const winnerId = await voting.winnerCandidateId();
            assert.strictEqual(Number(winnerId), 1);
        });

        it("투표 종료 후 getWinner는 공식 당선자를 반환해야 한다", async () => {
            const winner = await voting.getWinner();
            assert.strictEqual(Number(winner.id), 1);
            assert.strictEqual(winner.name, "강원모");
            assert.strictEqual(Number(winner.voteCount), 2);
            assert.strictEqual(winner.isOfficial, true);
        });

        it("투표 재개 시 winnerDeclared가 초기화되어야 한다", async () => {
            await voting.openVoting({ from: owner });
            const declared = await voting.winnerDeclared();
            const winnerId = await voting.winnerCandidateId();
            assert.strictEqual(declared, false);
            assert.strictEqual(Number(winnerId), 0);
        });

        it("아무도 투표하지 않고 종료해도 예외가 발생하지 않아야 한다", async () => {
            const fresh = await Voting.new(candidateNames, { from: owner });
            await fresh.closeVoting({ from: owner });
            const declared = await fresh.winnerDeclared();
            assert.strictEqual(declared, false);
        });
    });

    // ============================================================
    //  [7] 이벤트 검증
    // ============================================================
    describe("[7] 이벤트 검증", () => {
        let voting;
        before(async () => {
            voting = await Voting.new(candidateNames, { from: owner });
        });

        it("addVoter 호출 시 VoterAdded 이벤트가 발생해야 한다", async () => {
            const tx = await voting.addVoter(voter1, { from: owner });
            const event = tx.logs.find(l => l.event === "VoterAdded");
            assert.ok(event, "VoterAdded 이벤트가 없습니다");
            assert.strictEqual(event.args.voter.toLowerCase(), voter1.toLowerCase());
        });

        it("removeVoter 호출 시 VoterRemoved 이벤트가 발생해야 한다", async () => {
            const tx = await voting.removeVoter(voter1, { from: owner });
            const event = tx.logs.find(l => l.event === "VoterRemoved");
            assert.ok(event, "VoterRemoved 이벤트가 없습니다");
        });

        it("vote 호출 시 Voted 이벤트가 발생해야 한다", async () => {
            await voting.addVoter(voter1, { from: owner });
            const tx = await voting.vote(1, { from: voter1 });
            const event = tx.logs.find(l => l.event === "Voted");
            assert.ok(event, "Voted 이벤트가 없습니다");
            assert.strictEqual(Number(event.args.candidateId), 1);
        });

        it("closeVoting 호출 시 WinnerDeclared 이벤트가 발생해야 한다", async () => {
            const tx = await voting.closeVoting({ from: owner });
            const event = tx.logs.find(l => l.event === "WinnerDeclared");
            assert.ok(event, "WinnerDeclared 이벤트가 없습니다");
            assert.strictEqual(event.args.name, "강원모");
            assert.strictEqual(Number(event.args.voteCount), 1);
        });

        it("addCandidate 호출 시 CandidateAdded 이벤트가 발생해야 한다", async () => {
            const fresh = await Voting.new([], { from: owner });
            const tx = await fresh.addCandidate("신규후보", { from: owner });
            const event = tx.logs.find(l => l.event === "CandidateAdded");
            assert.ok(event, "CandidateAdded 이벤트가 없습니다");
            assert.strictEqual(event.args.name, "신규후보");
        });
    });

    // ============================================================
    //  [8] 통합 시나리오
    // ============================================================
    describe("[8] 통합 시나리오: 전체 투표 플로우", () => {

        it("전체 투표 플로우가 정상적으로 작동해야 한다", async () => {
            const voting = await Voting.new(["후보A", "후보B", "후보C"], { from: owner });

            await voting.addVoters([voter1, voter2, voter3], { from: owner });
            await voting.vote(1, { from: voter1 });
            await voting.vote(1, { from: voter2 });
            await voting.vote(2, { from: voter3 });

            const candA = await voting.candidates(1);
            const candB = await voting.candidates(2);
            const candC = await voting.candidates(3);
            assert.strictEqual(Number(candA.voteCount), 2);
            assert.strictEqual(Number(candB.voteCount), 1);
            assert.strictEqual(Number(candC.voteCount), 0);

            try {
                await voting.vote(1, { from: hacker });
                assert.fail("미등록 계정 투표가 차단되지 않았습니다");
            } catch (err) {
                assert.include(err.message, "revert");
            }

            const tx = await voting.closeVoting({ from: owner });
            const winnerEvent = tx.logs.find(l => l.event === "WinnerDeclared");
            assert.ok(winnerEvent, "WinnerDeclared 이벤트 없음");
            assert.strictEqual(winnerEvent.args.name, "후보A");

            const winner = await voting.getWinner();
            assert.strictEqual(Number(winner.id), 1);
            assert.strictEqual(winner.name, "후보A");
            assert.strictEqual(Number(winner.voteCount), 2);
            assert.strictEqual(winner.isOfficial, true);
        });

        it("owner도 화이트리스트 등록 후 투표할 수 있어야 한다", async () => {
            const fresh = await Voting.new(candidateNames, { from: owner });
            await fresh.addVoter(owner, { from: owner });
            await fresh.vote(1, { from: owner });
            const cand = await fresh.candidates(1);
            assert.strictEqual(Number(cand.voteCount), 1);
        });
    });
});