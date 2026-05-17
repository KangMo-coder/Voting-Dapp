const Voting = artifacts.require("Voting");

module.exports = function (deployer) {
  deployer.deploy(Voting, ["강원모", "박지훈", "김재원", "안건호", "엄성현"]);
  //                       ↑ constructor에 넘길 후보자 이름 배열
};