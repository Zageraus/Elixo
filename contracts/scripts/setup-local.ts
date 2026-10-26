/**
 * One-command setup for a local Hardhat chain (run after `npm run node`):
 *   npm run setup:local
 *
 * 1. Deploys MedicalAudit from the node's first account.
 * 2. Authorises the backend's signer (AUDIT_SIGNER_PRIVATE_KEY in
 *    backend/.env) and gives it test ETH if it isn't a pre-funded account.
 * 3. Writes the new AUDIT_CONTRACT_ADDRESS into backend/.env.
 *
 * A local chain starts empty every time the node restarts, so run this
 * again after each restart (and then restart the backend).
 */
import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

const BACKEND_ENV = path.resolve(__dirname, "../../backend/.env");

async function main() {
  if (network.name !== "localhost") {
    throw new Error(`Run this with --network localhost (got "${network.name}").`);
  }

  const backendEnv = dotenv.parse(fs.readFileSync(BACKEND_ENV));
  if (!backendEnv.AUDIT_SIGNER_PRIVATE_KEY) {
    throw new Error("AUDIT_SIGNER_PRIVATE_KEY is missing from backend/.env.");
  }
  const signerAddress = new ethers.Wallet(backendEnv.AUDIT_SIGNER_PRIVATE_KEY).address;

  const [deployer] = await ethers.getSigners();
  const contract = await (await ethers.getContractFactory("MedicalAudit")).deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`MedicalAudit deployed to ${address}`);

  if (signerAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await contract.authorizeSigner(signerAddress)).wait();
    console.log(`Authorised backend signer ${signerAddress}`);
  }

  const balance = await ethers.provider.getBalance(signerAddress);
  if (balance < ethers.parseEther("1")) {
    await (await deployer.sendTransaction({ to: signerAddress, value: ethers.parseEther("10") })).wait();
    console.log(`Sent 10 test ETH to ${signerAddress}`);
  }

  const env = fs.readFileSync(BACKEND_ENV, "utf8");
  const line = `AUDIT_CONTRACT_ADDRESS=${address}`;
  const updated = /^AUDIT_CONTRACT_ADDRESS=.*$/m.test(env)
    ? env.replace(/^AUDIT_CONTRACT_ADDRESS=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`;
  fs.writeFileSync(BACKEND_ENV, updated);
  console.log("Updated AUDIT_CONTRACT_ADDRESS in backend/.env. Restart the backend to pick it up.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
