import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { TokenGating } from "../target/types/token_gating";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

describe("token-gating-simple", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenGating as Program<TokenGating>;
  
  it("Initialize program ID", () => {
    console.log("Program ID:", program.programId.toString());
    expect(program.programId.toString()).to.equal("EHyipzMTK3FV63inZTyvqmSYqFxDdKJPKMhHay6yQ9mw");
  });
  
  it("Can generate a new keypair", () => {
    const kp = Keypair.generate();
    console.log("Generated keypair:", kp.publicKey.toString());
    expect(kp.publicKey).to.exist;
  });
}); 