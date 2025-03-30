const anchor = require('@coral-xyz/anchor');
const assert = require('assert');

describe('token-gating-basic-test', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it('Anchor is working', async () => {
    // Just check that anchor is set up correctly
    assert(provider.connection !== undefined);
    console.log("Provider connection:", provider.connection.rpcEndpoint);
  });
}); 