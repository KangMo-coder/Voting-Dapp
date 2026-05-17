module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*"
    }
  },
  compilers: {
    solc: {
      version: "0.8.20",
      settings: {                    // ← 이 블록 추가
        evmVersion: "london"         // ← PUSH0 없는 버전으로 고정
      }
    }
  }
};