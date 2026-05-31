// ============================================================
//  app.js — Decentralized Voting DApp 프론트엔드 로직
//
//  주요 기능:
//  1. MetaMask 지갑 연결 및 계정/네트워크 변경 감지
//  2. 컨트랙트 연동 (Ethers.js v6)
//  3. 후보자 목록 실시간 렌더링
//  4. 투표 기능 (로딩 스피너, 에러 핸들링)
//  5. 이벤트 구독 (Voted, WinnerDeclared → 실시간 UI 갱신)
//  6. 관리자 패널 (화이트리스트 관리, 투표 개폐, 후보자 추가)
//
//  의존성: Ethers.js v6 (index.html에서 CDN 스크립트 로드 필요)
//  로드 순서: ethers.umd.min.js → app.js
// ============================================================


// ============================================================
//  [0] 설정값 — truffle migrate 완료 후 반드시 수정
// ============================================================

// truffle migrate 실행 후 터미널에 출력된 주소로 교체
// 예: "0xAbc123...def456"
const CONTRACT_ADDRESS = "0x24eA55c823f2D3f606a55A636284CF2557C3353B";

// Voting.json 경로
// truffle compile 결과물이 같은 폴더에 있으면 "./Voting.json"
// 폴더 구조가 다르면 "../build/contracts/Voting.json" 으로 수정
const ABI_PATH = "../build/contracts/Voting.json";


// ============================================================
//  [1] 전역 상태 변수
// ============================================================

let provider       = null;  // Ethers.js BrowserProvider (MetaMask 연결 객체)
let signer         = null;  // 서명자: 트랜잭션을 발행하는 현재 지갑
let contract       = null;  // Voting 스마트 컨트랙트 인스턴스
let contractAbi    = null;  // 로드된 ABI (함수 목록 + 파라미터 정의)

let currentAccount = null;  // 현재 연결된 지갑 주소 (소문자)
let isOwner        = false; // 현재 사용자가 컨트랙트 owner인지 여부


// ============================================================
//  [2] 초기화 — DOM 로드 완료 후 자동 실행
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {

    // ABI 파일 먼저 로드 (이후 모든 컨트랙트 호출에 필요)
    await loadAbi();

    // MetaMask 미설치 시 안내 후 종료
    if (!window.ethereum) {
        showStatus("MetaMask가 설치되어 있지 않습니다. 설치 후 다시 시도하세요.", "error");
        const btn = document.getElementById('connect-btn');
        if (btn) btn.disabled = true;
        return;
    }

    // 이미 승인된 계정이 있으면 자동 연결 (페이지 새로고침 시 재연결)
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
        await connectWallet();
    }

    // MetaMask 계정 변경 감지
    // 사용자가 MetaMask에서 다른 지갑으로 전환하면 자동으로 DApp 재초기화
    window.ethereum.on('accountsChanged', async (accounts) => {
        if (accounts.length === 0) {
            handleDisconnect();
        } else {
            showStatus("계정이 변경됐습니다. 재연결합니다.", "info");
            await connectWallet();
        }
    });

    // 네트워크 변경 감지
    // Ganache ↔ 다른 네트워크 전환 시 컨트랙트 주소가 달라지므로 새로고침
    window.ethereum.on('chainChanged', () => {
        showStatus("네트워크가 변경됐습니다. 페이지를 새로고침합니다.", "warning");
        window.location.reload();
    });
});


// ============================================================
//  [3] ABI 로드
//  Truffle 빌드 결과물(Voting.json)에서 ABI 배열만 추출
//  ABI = 컨트랙트 함수 목록 + 파라미터 타입 정보
//        프론트엔드가 어떤 함수를 어떻게 호출할지 알기 위해 필요
// ============================================================

async function loadAbi() {
    try {
        const response = await fetch(ABI_PATH);
        if (!response.ok) {
            throw new Error(`파일을 찾을 수 없습니다 (경로: ${ABI_PATH})`);
        }
        const artifact = await response.json();
        contractAbi = artifact.abi;
        console.log("ABI 로드 완료. 함수 수:", contractAbi.length);
    } catch (err) {
        showStatus(`ABI 로드 실패: ${err.message}`, "error");
        console.error("ABI 로드 오류:", err);
    }
}


// ============================================================
//  [4] MetaMask 지갑 연결
// ============================================================

async function connectWallet() {
    try {
        showLoading(true, "MetaMask 연결 중...");

        // BrowserProvider: window.ethereum(MetaMask)을 Ethers.js와 연결하는 래퍼
        provider = new ethers.BrowserProvider(window.ethereum);

        // MetaMask에 계정 접근 권한 요청 → 팝업 창 뜸
        await provider.send("eth_requestAccounts", []);

        // getSigner(): 현재 MetaMask에서 선택된 계정을 서명자로 반환
        // 이후 contract.vote() 같은 트랜잭션은 이 서명자의 이름으로 발행됨
        signer = await provider.getSigner();
        currentAccount = (await signer.getAddress()).toLowerCase();

        // 지갑 주소 UI 표시 (0x1234...5678 형식으로 축약)
        const el = document.getElementById('wallet-address');
        if (el) {
            el.textContent =
                `${currentAccount.slice(0, 6)}...${currentAccount.slice(-4)}`;
        }
        const btn = document.getElementById('connect-btn');
        if (btn) {
            btn.textContent = '연결됨';
            btn.disabled    = true;
        }

        // 컨트랙트 인스턴스 생성 및 초기 렌더링
        await connectContract();

    } catch (err) {
        showStatus("지갑 연결 실패: " + err.message, "error");
        console.error("지갑 연결 오류:", err);
    } finally {
        showLoading(false);
    }
}


// ============================================================
//  [5] 스마트 컨트랙트 연결
//  ABI + 배포 주소 + 서명자 → Contract 인스턴스 생성
// ============================================================

async function connectContract() {
    if (!contractAbi) {
        showStatus("ABI가 없습니다. 페이지를 새로고침하세요.", "error");
        return;
    }

    // Contract 인스턴스 생성
    // contractAbi : "이 컨트랙트에는 어떤 함수가 있고 파라미터는 뭔지"
    // CONTRACT_ADDRESS : "이 함수들이 배포된 블록체인 주소"
    // signer            : "트랜잭션 발행 시 MetaMask가 이 계정으로 서명"
    contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, signer);

    // owner 확인 → 관리자 패널 표시 여부 결정
    const ownerAddress = await contract.owner();
    isOwner = currentAccount === ownerAddress.toLowerCase();

    const adminPanel = document.getElementById('admin-panel');
    if (adminPanel) {
        adminPanel.style.display = isOwner ? 'block' : 'none';
    }

    // 이벤트 구독 등록 (실시간 UI 갱신 핵심)
    setupContractEventListeners();

    // 초기 화면 렌더링
    await updateDashboard();
}


// ============================================================
//  [6] 이벤트 리스너 — 실시간 UI 갱신의 핵심
//
//  블록체인 이벤트를 구독해두면:
//  내가 직접 투표하지 않아도 다른 사람이 투표하는 순간
//  Voted 이벤트가 발생 → 콜백 실행 → 화면 자동 갱신
// ============================================================

function setupContractEventListeners() {

    // 기존 리스너 전부 제거 (계정 전환 시 중복 등록 방지)
    contract.removeAllListeners();

    // Voted 이벤트 구독
    // 누군가 vote() 트랜잭션을 성공적으로 완료할 때마다 발생
    // voter: 투표한 지갑 주소 / candidateId: 투표받은 후보 번호
    contract.on("Voted", (voter, candidateId) => {
        console.log(`새 투표 감지: ${voter} → 후보 ${Number(candidateId)}번`);
        showStatus(`새 투표가 반영됐습니다. (${Number(candidateId)}번 후보)`, "info");
        updateDashboard();
    });

    // WinnerDeclared 이벤트 구독
    // 관리자가 closeVoting()을 호출하는 순간 발생
    // 당선자 이름과 득표수를 이벤트에서 직접 받아 즉시 표시
    contract.on("WinnerDeclared", (candidateId, name, voteCount) => {
        console.log(`당선자 확정: ${name} (${Number(voteCount)}표)`);
        showStatus(`🏆 투표 종료! 당선자: ${name} (${Number(voteCount)}표)`, "success");
        updateDashboard();
    });

    // VoterAdded 이벤트 구독
    // 관리자가 addVoter()로 내 주소를 등록하면 즉시 화이트리스트 상태 갱신
    contract.on("VoterAdded", async (voter) => {
        if (voter.toLowerCase() === currentAccount) {
            await updateWhitelistStatus();
            showStatus("✅ 투표 권한이 부여됐습니다!", "success");
        }
    });

    // VoterRemoved 이벤트 구독
    contract.on("VoterRemoved", async (voter) => {
        if (voter.toLowerCase() === currentAccount) {
            await updateWhitelistStatus();
            showStatus("⚠️ 투표 권한이 회수됐습니다.", "warning");
        }
    });
}


// ============================================================
//  [7] 대시보드 전체 갱신
//  컨트랙트에서 최신 데이터를 읽어와 화면 전체를 다시 그림
// ============================================================

async function updateDashboard() {
    if (!contract) return;

    try {
        // Promise.all: view 함수 3개를 병렬 호출 (순차 호출보다 빠름)
        // view 함수는 블록체인 읽기 전용 → 가스비 없음
        const [candidates, votingOpen, hasVoted] = await Promise.all([
            contract.getAllCandidates(),
            contract.votingOpen(),
            contract.checkIfVoted(currentAccount)
        ]);

        // 화이트리스트 상태 확인
        await updateWhitelistStatus();

        // 투표 진행/종료 상태 배너
        updateVotingStatusUI(votingOpen);

        // 후보자 카드 목록 렌더링
        renderCandidates(candidates, votingOpen, hasVoted);

        // 현재 1위 / 당선자 섹션 갱신
        await updateWinnerDisplay();

        // [UI 버그 수정] 후보자 수 카드 갱신
        const countEl = document.getElementById('candidate-count');
        if (countEl) countEl.textContent = `${candidates.length}명`;

        // [UI 버그 수정] 투표 현황 통계 카드 갱신
        const total = candidates.reduce((s, c) => s + Number(c.voteCount), 0);
        const statsEl = document.getElementById('stats-body');
        if (statsEl) {
            statsEl.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:var(--text-sub)">총 투표 수</span>
                        <span style="color:var(--cyan);font-weight:600;">${total}표</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:var(--text-sub)">후보자 수</span>
                        <span style="color:var(--text)">${candidates.length}명</span>
                    </div>
                </div>`;
        }

    } catch (err) {
        console.error("대시보드 갱신 오류:", err);
        showStatus("데이터 로드 중 오류가 발생했습니다.", "error");
    }
}


// ============================================================
//  [8] 후보자 목록 렌더링
//  candidates: Candidate 구조체 배열
//  votingOpen: 투표 가능 여부 (버튼 활성화 조건)
//  hasVoted  : 현재 계정 투표 여부 (중복 투표 방지 UI)
// ============================================================

function renderCandidates(candidates, votingOpen, hasVoted) {
    const container = document.getElementById('candidates-container');
    if (!container) return;

    if (candidates.length === 0) {
        container.innerHTML = '<p class="empty-msg">등록된 후보자가 없습니다.</p>';
        return;
    }

    // 득표율 계산을 위한 총 투표 수
    const totalVotes = candidates.reduce(
        (sum, c) => sum + Number(c.voteCount), 0
    );

    container.innerHTML = candidates.map(candidate => {
        const id      = Number(candidate.id);
        const name    = candidate.name;
        const votes   = Number(candidate.voteCount);
        const percent = totalVotes > 0
            ? ((votes / totalVotes) * 100).toFixed(1)
            : 0;

        // 투표 버튼 활성화 조건:
        // ① 투표 기간 중 (votingOpen === true)
        // ② 아직 투표하지 않음 (!hasVoted)
        // → 둘 중 하나라도 false면 버튼 비활성화
        const canVote = votingOpen && !hasVoted;

        let btnText = '투표하기';
        if (!votingOpen)   btnText = '투표 종료';
        else if (hasVoted) btnText = '투표 완료';

        return `
            <div class="candidate-card" id="candidate-${id}">
                <div class="candidate-info">
                    <span class="candidate-number">${id}번</span>
                    <span class="candidate-name">${name}</span>
                </div>
                <div class="vote-bar-wrap">
                    <div class="vote-bar" style="width: ${percent}%"></div>
                </div>
                <div class="vote-stats">
                    <span class="vote-count">${votes}표</span>
                    <span class="vote-percent">${percent}%</span>
                </div>
                <button
                    class="vote-btn ${canVote ? 'active' : 'disabled'}"
                    onclick="voteForCandidate(${id}, this)"
                    ${canVote ? '' : 'disabled'}
                >
                    ${btnText}
                </button>
            </div>
        `;
    }).join('');
}


// ============================================================
//  [9] 투표 상태 배너 UI 갱신
// ============================================================

function updateVotingStatusUI(isOpen) {
    const el = document.getElementById('voting-status');
    if (!el) return;
    el.textContent = isOpen ? '🟢 투표 진행 중' : '🔴 투표 종료';
    el.className   = `voting-status ${isOpen ? 'status-open' : 'status-closed'}`;
}


// ============================================================
//  [10] 화이트리스트 상태 UI 갱신
// ============================================================

async function updateWhitelistStatus() {
    if (!contract || !currentAccount) return;

    const isListed = await contract.isWhitelisted(currentAccount);
    const el = document.getElementById('whitelist-status');
    if (!el) return;

    el.textContent = isListed
        ? '✅ 투표 권한 있음'
        : '❌ 투표 권한 없음 (관리자에게 문의)';
    el.className = `whitelist-status ${isListed ? 'whitelist-ok' : 'whitelist-denied'}`;
}


// ============================================================
//  [11] 당선자 / 현재 1위 UI 갱신
// ============================================================

async function updateWinnerDisplay() {
    if (!contract) return;

    const winnerSection = document.getElementById('winner-section');
    if (!winnerSection) return;

    try {
        // getWinner() 반환값:
        // [id, name, voteCount, isTied, isOfficial]
        const [id, name, voteCount, isTied, isOfficial] =
            await contract.getWinner();

        if (Number(id) === 0) {
            // 아직 아무도 투표하지 않은 상태
            winnerSection.style.display = 'none';
            return;
        }

        winnerSection.style.display = 'block';

        const nameEl   = document.getElementById('winner-name');
        const votesEl  = document.getElementById('winner-votes');
        const labelEl  = document.getElementById('winner-label');

        if (nameEl)  nameEl.textContent  = name;
        if (votesEl) votesEl.textContent = `${Number(voteCount)}표`;

        if (labelEl) {
            if (isOfficial) {
                // closeVoting() 이후 → 공식 당선자
                labelEl.textContent = isTied
                    ? '🏆 공동 당선 (동점 시 먼저 등록된 후보 당선)'
                    : '🏆 최종 당선자';
                labelEl.className = 'winner-label label-official';
            } else {
                // 투표 진행 중 → 현재 1위 (비공식)
                labelEl.textContent = isTied ? '📊 현재 공동 1위' : '📊 현재 1위';
                labelEl.className   = 'winner-label label-live';
            }
        }

    } catch (err) {
        // "No candidates registered" 같은 예외는 무시
        console.log("당선자 조회 건너뜀:", err.message);
        winnerSection.style.display = 'none';
    }
}


// ============================================================
//  [12] 투표 함수
//
//  흐름:
//  버튼 클릭 → 버튼 비활성화 → MetaMask 서명 창
//  → tx 전송 → 블록 포함 대기 (10~15초) → 성공/실패 처리
// ============================================================

async function voteForCandidate(candidateId, btn) {
    if (!contract) {
        showStatus("컨트랙트에 연결되어 있지 않습니다.", "error");
        return;
    }

    // 즉시 버튼 비활성화 → 연속 클릭으로 중복 트랜잭션 방지
    if (btn) {
        btn.disabled    = true;
        btn.textContent = '처리 중...';
    }

    try {
        showLoading(true, "MetaMask 서명 창을 확인해주세요...");

        // vote() 호출 → MetaMask 팝업 뜨고 사용자가 서명하면 tx 객체 반환
        // 이 시점에서는 아직 블록에 포함되지 않음 (펜딩 상태)
        const tx = await contract.vote(candidateId);

        showLoading(true, `블록 생성 대기 중... (약 10~15초)\n트랜잭션: ${tx.hash.slice(0, 10)}...`);

        // tx.wait(): 트랜잭션이 블록에 포함(채굴)될 때까지 대기
        // 반환된 receipt에 실제 블록 번호, 가스 소모량 등이 담김
        const receipt = await tx.wait();

        console.log("트랜잭션 완료:", receipt.hash);
        showStatus(
            `✅ 투표 완료! 트랜잭션 해시: ${receipt.hash.slice(0, 12)}...`,
            "success"
        );

        // 이벤트 리스너가 갱신하지만, 확실히 하기 위해 직접 호출
        await updateDashboard();

    } catch (err) {
        const reason = parseContractError(err);
        showStatus(`❌ 투표 실패: ${reason}`, "error");
        console.error("투표 오류:", err);

        // 트랜잭션 실패 시에만 버튼 복구
        // (성공 시에는 updateDashboard가 버튼을 '투표 완료'로 다시 그림)
        if (btn) {
            btn.disabled    = false;
            btn.textContent = '투표하기';
        }
    } finally {
        showLoading(false);
    }
}


// ============================================================
//  [13] 관리자 함수들
//  isOwner가 true일 때만 UI에 표시됨
// ============================================================

// 유권자 1명 화이트리스트 등록
async function addVoter() {
    const input   = document.getElementById('voter-address-input');
    const address = input?.value.trim();
    if (!address) {
        showStatus("등록할 지갑 주소를 입력하세요.", "error");
        return;
    }

    try {
        showLoading(true, "유권자 등록 중...");
        const tx = await contract.addVoter(address);
        await tx.wait();
        showStatus(`✅ ${address.slice(0, 10)}... 등록 완료`, "success");
        if (input) input.value = '';
    } catch (err) {
        showStatus(`❌ 등록 실패: ${parseContractError(err)}`, "error");
    } finally {
        showLoading(false);
    }
}

// 유권자 여러 명 일괄 등록 (쉼표로 구분된 주소 목록 입력)
// 예: "0xABC..., 0xDEF..., 0x123..."
async function addVoters() {
    const input = document.getElementById('voters-list-input');
    const raw   = input?.value.trim();
    if (!raw) {
        showStatus("주소 목록을 입력하세요. (쉼표로 구분)", "error");
        return;
    }

    const addresses = raw
        .split(',')
        .map(a => a.trim())
        .filter(a => a.length > 0);

    if (addresses.length === 0) {
        showStatus("유효한 주소가 없습니다.", "error");
        return;
    }

    try {
        showLoading(true, `${addresses.length}명 일괄 등록 중...`);
        const tx = await contract.addVoters(addresses);
        await tx.wait();
        showStatus(`✅ ${addresses.length}명 일괄 등록 완료`, "success");
        if (input) input.value = '';
    } catch (err) {
        showStatus(`❌ 일괄 등록 실패: ${parseContractError(err)}`, "error");
    } finally {
        showLoading(false);
    }
}

// 유권자 등록 취소
async function removeVoter() {
    const input   = document.getElementById('remove-voter-input');
    const address = input?.value.trim();
    if (!address) {
        showStatus("제거할 주소를 입력하세요.", "error");
        return;
    }

    try {
        showLoading(true, "유권자 제거 중...");
        const tx = await contract.removeVoter(address);
        await tx.wait();
        showStatus(`✅ ${address.slice(0, 10)}... 제거 완료`, "success");
        if (input) input.value = '';
    } catch (err) {
        showStatus(`❌ 제거 실패: ${parseContractError(err)}`, "error");
    } finally {
        showLoading(false);
    }
}

// 후보자 추가
async function addCandidate() {
    const input = document.getElementById('candidate-name-input');
    const name  = input?.value.trim();
    if (!name) {
        showStatus("후보자 이름을 입력하세요.", "error");
        return;
    }

    try {
        showLoading(true, "후보자 등록 중...");
        const tx = await contract.addCandidate(name);
        await tx.wait();
        showStatus(`✅ 후보자 "${name}" 등록 완료`, "success");
        if (input) input.value = '';
        await updateDashboard();
    } catch (err) {
        showStatus(`❌ 후보자 등록 실패: ${parseContractError(err)}`, "error");
    } finally {
        showLoading(false);
    }
}

// 투표 종료 (당선자 자동 선언 포함)
async function closeVoting() {
    if (!confirm("투표를 종료하시겠습니까?\n종료 즉시 당선자가 자동으로 선언됩니다.")) return;

    try {
        showLoading(true, "투표 종료 처리 중...");
        const tx = await contract.closeVoting();
        await tx.wait();
        showStatus("✅ 투표가 종료됐습니다. 당선자가 확정됐습니다.", "success");
        await updateDashboard();
    } catch (err) {
        showStatus(`❌ 투표 종료 실패: ${parseContractError(err)}`, "error");
    } finally {
        showLoading(false);
    }
}

// 투표 재개
async function openVoting() {
    if (!confirm("투표를 재개하시겠습니까?\n이전 당선자 선언이 초기화됩니다.")) return;

    try {
        showLoading(true, "투표 재개 처리 중...");
        const tx = await contract.openVoting();
        await tx.wait();
        showStatus("✅ 투표가 재개됐습니다.", "success");
        await updateDashboard();
    } catch (err) {
        showStatus(`❌ 투표 재개 실패: ${parseContractError(err)}`, "error");
    } finally {
        showLoading(false);
    }
}


// ============================================================
//  [14] 유틸리티 함수
// ============================================================

// 지갑 연결 해제 처리
function handleDisconnect() {
    provider = signer = contract = currentAccount = null;
    isOwner = false;

    const walletEl = document.getElementById('wallet-address');
    const btn      = document.getElementById('connect-btn');
    const adminEl  = document.getElementById('admin-panel');

    if (walletEl) walletEl.textContent = '연결되지 않음';
    if (btn)      { btn.textContent = '지갑 연결'; btn.disabled = false; }
    if (adminEl)  adminEl.style.display = 'none';

    showStatus("지갑 연결이 해제됐습니다.", "warning");
}

// 상태 메시지 표시
// type: "success" | "error" | "warning" | "info"
function showStatus(message, type = "info") {
    const el = document.getElementById('status-message');
    if (!el) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }
    el.textContent   = message;
    el.className     = `status-msg status-${type}`;
    el.style.display = 'block';

    // 성공/정보 메시지는 5초 후 자동 숨김
    if (type === 'success' || type === 'info') {
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
}

// 로딩 오버레이 표시/숨김
// 트랜잭션 대기 중 사용자 입력 차단
function showLoading(show, message = "처리 중...") {
    const overlay = document.getElementById('loading-overlay');
    const msgEl   = document.getElementById('loading-message');
    if (!overlay) return;

    overlay.style.display = show ? 'flex' : 'none';
    if (msgEl) msgEl.textContent = message;
}

// 컨트랙트 에러 메시지 파싱
// require() 실패 → Solidity 에러 메시지 → 한국어로 변환
function parseContractError(error) {
    // Ethers.js v6에서 에러 메시지가 담길 수 있는 위치를 순서대로 확인
    const raw = error?.reason
        ?? error?.data?.message
        ?? error?.message
        ?? "알 수 없는 오류";

    // Solidity 에러 메시지 → 한국어 매핑
    const errorMap = {
        "You have already voted"      : "이미 투표하셨습니다.",
        "Voting is not open"          : "현재 투표 기간이 아닙니다.",
        "Invalid candidate ID"        : "유효하지 않은 후보자 번호입니다.",
        "Not authorized"              : "투표 권한이 없습니다. 관리자에게 문의하세요.",
        "Only owner can call"         : "관리자만 사용할 수 있는 기능입니다.",
        "Already whitelisted"         : "이미 등록된 주소입니다.",
        "Address is not whitelisted"  : "등록되지 않은 주소입니다.",
        "Voting is already closed"    : "이미 종료된 투표입니다.",
        "Voting is already open"      : "이미 진행 중인 투표입니다.",
        "user rejected"               : "MetaMask에서 서명을 거부하셨습니다.",
        "Invalid address"             : "유효하지 않은 주소입니다.",
        "Candidate name cannot be empty" : "후보자 이름을 입력하세요.",
    };

    // 부분 문자열 매칭
    for (const [key, value] of Object.entries(errorMap)) {
        if (raw.toLowerCase().includes(key.toLowerCase())) return value;
    }

    return raw;
}