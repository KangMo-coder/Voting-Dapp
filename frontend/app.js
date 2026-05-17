// ============================================================
//  app.js — 프론트엔드와 블록체인을 연결하는 브릿지 로직
// ============================================================

// 전역 변수 선언
let provider;       // 블록체인 네트워크와 통신하는 역할
let signer;         // 트랜잭션에 서명(결제/투표)하는 내 지갑 정보
let votingContract; // 스마트 컨트랙트와 상호작용하는 객체
let myAddress;

// 🚨 [매우 중요] 우리가 배포한 컨트랙트의 '주소'와 '설명서(ABI)'
// 이 두 가지가 있어야 자바스크립트가 블록체인 상의 어느 주소에, 어떤 함수들이 있는지 알 수 있습니다.
const CONTRACT_ADDRESS = "0xB0AF5140D677bC46174bC4E5fE36FB82C75B6A51"; // 배포 후 실제 주소로 변경 필요

const CONTRACT_ABI = [ 
    {
      "inputs": [
        {
          "internalType": "string[]",
          "name": "candidateNames",
          "type": "string[]"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "candidateId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "string",
          "name": "name",
          "type": "string"
        }
      ],
      "name": "CandidateAdded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "voter",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "candidateId",
          "type": "uint256"
        }
      ],
      "name": "Voted",
      "type": "event"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "candidates",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "id",
          "type": "uint256"
        },
        {
          "internalType": "string",
          "name": "name",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "voteCount",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [],
      "name": "candidatesCount",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "hasVoted",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [],
      "name": "owner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [],
      "name": "votingOpen",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "name",
          "type": "string"
        }
      ],
      "name": "addCandidate",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "candidateId",
          "type": "uint256"
        }
      ],
      "name": "vote",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "candidateId",
          "type": "uint256"
        }
      ],
      "name": "getCandidate",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "id",
          "type": "uint256"
        },
        {
          "internalType": "string",
          "name": "name",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "voteCount",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [],
      "name": "getAllCandidates",
      "outputs": [
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "id",
              "type": "uint256"
            },
            {
              "internalType": "string",
              "name": "name",
              "type": "string"
            },
            {
              "internalType": "uint256",
              "name": "voteCount",
              "type": "uint256"
            }
          ],
          "internalType": "struct Voting.Candidate[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "voter",
          "type": "address"
        }
      ],
      "name": "checkIfVoted",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function",
      "constant": true
    },
    {
      "inputs": [],
      "name": "closeVoting",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "openVoting",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ];
    // 여기에 build/contracts/Voting.json 파일의 "abi" 배열 내용을 넣을 예정입니다.


// ------------------------------------------------------------
// [1] 지갑 연결 및 초기화
// ------------------------------------------------------------
async function connectWallet() {
    if (window.ethereum == null) {
        alert("메타마스크(MetaMask) 확장 프로그램을 설치해 주세요!");
        return;
    }

    try {
        setUIStatus(true, "지갑 연결 중...", "blue");
        
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        myAddress = await signer.getAddress();
        
        document.getElementById("walletAddress").innerText = myAddress;
        setUIStatus(false, "✅ 지갑 연결 성공!", "green");

        // 컨트랙트 객체 생성 후 화면 데이터 갱신
        votingContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
        await updateDashboard(); 

    } catch (error) {
        console.error("지갑 연결 에러:", error);
        setUIStatus(false, "❌ 지갑 연결 취소 또는 에러 발생", "red");
    }
}

document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);

// ------------------------------------------------------------
// [2] 대시보드 업데이트 (후보자, 투표 상태, 관리자 권한 확인)
// ------------------------------------------------------------
async function updateDashboard() {
    try {
        setUIStatus(true, "블록체인에서 데이터를 불러오는 중입니다...", "blue");

        // 컨트랙트에서 다중 데이터 비동기 호출
        const [candidates, isOpen, isVoted, ownerAddr] = await Promise.all([
            votingContract.getAllCandidates(),
            votingContract.votingOpen(),
            votingContract.hasVoted(myAddress),
            votingContract.owner()
        ]);

        // 투표 상태 뱃지 업데이트 (피드백 반영)
        const badge = document.getElementById("votingStatusBadge");
        badge.innerText = isOpen ? "🟢 투표 진행 중" : "🔴 투표 종료";
        badge.className = `badge ${isOpen ? 'badge-open' : 'badge-closed'}`;

        // 관리자 패널 제어 (피드백 반영)
        const adminPanel = document.getElementById("adminPanel");
        if (myAddress.toLowerCase() === ownerAddr.toLowerCase()) {
            adminPanel.style.display = "block";
        } else {
            adminPanel.style.display = "none";
        }

        // 후보자 목록 렌더링
        const listDiv = document.getElementById("candidatesList");
        listDiv.innerHTML = "";

        for (let i = 0; i < candidates.length; i++) {
            const id = candidates[i].id.toString();
            const name = candidates[i].name;
            const voteCount = candidates[i].voteCount.toString();

            // 피드백 반영: 투표가 닫혔거나 이미 투표했으면 버튼 비활성화
            const isButtonDisabled = !isOpen || isVoted;
            let buttonText = "투표하기";
            if (!isOpen) buttonText = "투표 종료됨";
            else if (isVoted) buttonText = "투표 완료";

            const card = document.createElement("div");
            card.className = "card";
            card.innerHTML = `
                <h3>기호 ${id}번: ${name}</h3>
                <p>현재 득표수: <strong>${voteCount}</strong> 표</p>
                <button onclick="voteForCandidate(${id})" class="btn-vote" ${isButtonDisabled ? 'disabled' : ''}>
                    ${buttonText}
                </button>
            `;
            listDiv.appendChild(card);
        }

        setUIStatus(false, "데이터 로드 완료", "green");

    } catch (error) {
        console.error("데이터 로드 에러:", error);
        setUIStatus(false, "❌ 데이터를 불러오는데 실패했습니다.", "red");
    }
}

// ------------------------------------------------------------
// [3] 투표 실행 로직 (에러 파싱 피드백 완벽 반영)
// ------------------------------------------------------------
async function voteForCandidate(candidateId) {
    try {
        setUIStatus(true, "⏳ 메타마스크에서 트랜잭션을 승인해 주세요...", "orange");
        
        const tx = await votingContract.vote(candidateId);

        setUIStatus(true, "⛏️ 블록체인에 투표를 기록 중입니다. (약 10~15초 소요)", "blue");
        await tx.wait(); // 블록 생성 대기

        setUIStatus(false, "✅ 투표가 성공적으로 완료되었습니다!", "green");
        
        // 데이터 최신화
        await updateDashboard();

    } catch (error) {
        console.error("투표 에러 상세:", error);
        
        // 피드백 반영: Ethers v6의 중첩 에러 객체 파싱
        const reason = error?.reason ?? error?.data?.message ?? error?.message ?? "";
        let userMessage = "❌ 투표 과정에서 오류가 발생했거나 취소되었습니다.";

        if (reason.includes("already voted")) {
            userMessage = "❌ 이미 투표에 참여하셨습니다. (중복 투표 불가)";
        } else if (reason.includes("not open")) {
            userMessage = "❌ 현재 투표 기간이 아닙니다.";
        } else if (error.code === "ACTION_REJECTED") {
            userMessage = "❌ 사용자가 지갑 서명을 거부했습니다.";
        }

        setUIStatus(false, userMessage, "red");
    }
}

// ------------------------------------------------------------
// [4] 관리자 기능 (피드백 반영: 투표 개폐 제어)
// ------------------------------------------------------------
async function toggleVoting(open) {
    try {
        setUIStatus(true, `⏳ 투표 상태를 ${open ? '시작' : '종료'}으로 변경 중입니다...`, "orange");
        
        const tx = open ? await votingContract.openVoting() : await votingContract.closeVoting();
        await tx.wait();

        setUIStatus(false, "✅ 상태 변경 완료!", "green");
        await updateDashboard();

    } catch (error) {
        const reason = error?.reason ?? error?.data?.message ?? error?.message ?? "";
        let userMessage = "❌ 관리자 명령 실행 실패";
        
        if (reason.includes("already")) userMessage = "❌ 이미 해당 상태입니다.";
        else if (error.code === "ACTION_REJECTED") userMessage = "❌ 서명을 취소했습니다.";
        
        setUIStatus(false, userMessage, "red");
    }
}

// ------------------------------------------------------------
// [유틸리티] UI 상태 변경 헬퍼 함수
// ------------------------------------------------------------
function setUIStatus(isLoading, message, color) {
    const spinner = document.getElementById("loadingSpinner");
    const statusMsg = document.getElementById("statusMessage");
    
    spinner.style.display = isLoading ? "block" : "none";
    statusMsg.innerText = message;
     // HTML 로드 완료 후 이벤트 리스너 등록
    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);
    });   statusMsg.style.color = color;
}