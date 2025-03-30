import { expect } from "chai";
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

describe("Solana Test Validator Tests", () => {
  // Connect to the running test validator
  const connection = new Connection("http://localhost:8899", "confirmed");
  const wallet = Keypair.generate();

  it("Can connect to the validator", async () => {
    const version = await connection.getVersion();
    console.log("Solana version:", version);
    expect(version).to.exist;
  });

  it("Can request an airdrop", async () => {
    const airdropAmount = 1 * LAMPORTS_PER_SOL;
    const signature = await connection.requestAirdrop(
      wallet.publicKey, 
      airdropAmount
    );
    await connection.confirmTransaction(signature);
    
    const balance = await connection.getBalance(wallet.publicKey);
    console.log("Wallet balance:", balance / LAMPORTS_PER_SOL, "SOL");
    expect(balance).to.equal(airdropAmount);
  });
}); 