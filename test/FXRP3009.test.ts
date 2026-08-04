import { expect } from "chai";
import { ethers } from "hardhat";
import type { Signer } from "ethers";
import type { FXRP3009, MockFXRP } from "../typechain-types";

const SESSION_BUDGET = 1_000_000n; // 1.0 FXRP at 6 decimals
const TICK_VALUE = 1_000n; // 0.001 FXRP per tick

async function deployFixture() {
  const [deployer, payer, payee, facilitator, stranger] = await ethers.getSigners();

  const MockFXRP = await ethers.getContractFactory("MockFXRP");
  const fxrp = (await MockFXRP.deploy()) as unknown as MockFXRP;
  await fxrp.waitForDeployment();

  const FXRP3009 = await ethers.getContractFactory("FXRP3009");
  const shim = (await FXRP3009.deploy(await fxrp.getAddress())) as unknown as FXRP3009;
  await shim.waitForDeployment();

  await fxrp.mint(await payer.getAddress(), SESSION_BUDGET);

  return { deployer, payer, payee, facilitator, stranger, fxrp, shim };
}

async function signPermit(
  fxrp: MockFXRP,
  owner: Signer,
  spender: string,
  value: bigint,
  deadline: bigint
) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const ownerAddress = await owner.getAddress();
  const nonce = await fxrp.nonces(ownerAddress);

  const domain = {
    name: "FXRP",
    version: "1",
    chainId,
    verifyingContract: await fxrp.getAddress(),
  };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value_ = { owner: ownerAddress, spender, value, nonce, deadline };

  const signature = await owner.signTypedData(domain, types, value_);
  return ethers.Signature.from(signature);
}

async function signTransferAuthorization(
  shim: FXRP3009,
  from: Signer,
  to: string,
  value: bigint,
  validAfter: bigint,
  validBefore: bigint,
  nonce: string,
  action: "TransferWithAuthorization" | "ReceiveWithAuthorization" = "TransferWithAuthorization"
) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const fromAddress = await from.getAddress();

  const domain = {
    name: "FXRP3009",
    version: "1",
    chainId,
    verifyingContract: await shim.getAddress(),
  };
  const types = {
    [action]: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = { from: fromAddress, to, value, validAfter, validBefore, nonce };

  const signature = await from.signTypedData(domain, types, message);
  return ethers.Signature.from(signature);
}

const FAR_FUTURE = 9_999_999_999n;

describe("FXRP3009", () => {
  describe("permit-funded allowance", () => {
    it("lets the payer establish the session allowance gaslessly via EIP-2612 permit", async () => {
      const { fxrp, shim, payer } = await deployFixture();
      const deadline = FAR_FUTURE;
      const sig = await signPermit(fxrp, payer, await shim.getAddress(), SESSION_BUDGET, deadline);

      await fxrp.permit(await payer.getAddress(), await shim.getAddress(), SESSION_BUDGET, deadline, sig.v, sig.r, sig.s);

      expect(await fxrp.allowance(await payer.getAddress(), await shim.getAddress())).to.equal(SESSION_BUDGET);
    });
  });

  describe("transferWithAuthorization", () => {
    async function openSession() {
      const fixture = await deployFixture();
      const { fxrp, shim, payer } = fixture;
      const deadline = FAR_FUTURE;
      const permitSig = await signPermit(fxrp, payer, await shim.getAddress(), SESSION_BUDGET, deadline);
      await fxrp.permit(await payer.getAddress(), await shim.getAddress(), SESSION_BUDGET, deadline, permitSig.v, permitSig.r, permitSig.s);
      return fixture;
    }

    it("moves FXRP directly from payer to payee on a valid tick", async () => {
      const { shim, fxrp, payer, payee, facilitator } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce);

      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(
            await payer.getAddress(),
            await payee.getAddress(),
            TICK_VALUE,
            0n,
            FAR_FUTURE,
            nonce,
            sig.v,
            sig.r,
            sig.s
          )
      )
        .to.emit(shim, "AuthorizationUsed")
        .withArgs(await payer.getAddress(), nonce);

      expect(await fxrp.balanceOf(await payee.getAddress())).to.equal(TICK_VALUE);
      expect(await fxrp.balanceOf(await payer.getAddress())).to.equal(SESSION_BUDGET - TICK_VALUE);
      expect(await shim.authorizationState(await payer.getAddress(), nonce)).to.equal(true);
    });

    it("lets any address (the facilitator) submit the tick, per EIP-3009", async () => {
      const { shim, payer, payee, stranger } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce);

      await expect(
        shim
          .connect(stranger)
          .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s)
      ).to.not.be.reverted;
    });

    it("rejects replay of an already-used nonce", async () => {
      const { shim, payer, payee, facilitator } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce);

      await shim
        .connect(facilitator)
        .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s);

      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s)
      )
        .to.be.revertedWithCustomError(shim, "AuthorizationAlreadyUsed")
        .withArgs(await payer.getAddress(), nonce);
    });

    it("rejects an authorization submitted after validBefore", async () => {
      const { shim, payer, payee, facilitator } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const validBefore = BigInt(Math.floor(Date.now() / 1000) - 3600); // already expired
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, validBefore, nonce);

      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, validBefore, nonce, sig.v, sig.r, sig.s)
      ).to.be.revertedWithCustomError(shim, "AuthorizationExpired");
    });

    it("rejects an authorization submitted before validAfter", async () => {
      const { shim, payer, payee, facilitator } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const validAfter = FAR_FUTURE; // not valid until far in the future
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, validAfter, FAR_FUTURE + 1n, nonce);

      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(
            await payer.getAddress(),
            await payee.getAddress(),
            TICK_VALUE,
            validAfter,
            FAR_FUTURE + 1n,
            nonce,
            sig.v,
            sig.r,
            sig.s
          )
      ).to.be.revertedWithCustomError(shim, "AuthorizationNotYetValid");
    });

    it("rejects a signature from anyone other than the named payer", async () => {
      const { shim, payer, payee, facilitator, stranger } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      // stranger signs, but the authorization claims to be from `payer`
      const sig = await signTransferAuthorization(shim, stranger, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce);

      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s)
      ).to.be.revertedWithCustomError(shim, "InvalidSignature");
    });

    it("rejects a tick that would overspend the standing allowance", async () => {
      const { shim, payer, payee, facilitator } = await openSession();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const overspend = SESSION_BUDGET + 1n;
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), overspend, 0n, FAR_FUTURE, nonce);

      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), overspend, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s)
      ).to.be.reverted;
    });

    it("rejects ticks once the session allowance is exhausted across multiple authorizations", async () => {
      const { shim, payer, payee, facilitator } = await openSession();
      const ticksToExhaustBudget = SESSION_BUDGET / TICK_VALUE;

      for (let i = 0n; i < ticksToExhaustBudget; i++) {
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce);
        await shim
          .connect(facilitator)
          .transferWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s);
      }

      const oneTickTooMany = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, oneTickTooMany);
      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(
            await payer.getAddress(),
            await payee.getAddress(),
            TICK_VALUE,
            0n,
            FAR_FUTURE,
            oneTickTooMany,
            sig.v,
            sig.r,
            sig.s
          )
      ).to.be.reverted;
    });
  });

  describe("receiveWithAuthorization", () => {
    it("succeeds when the payee itself submits it", async () => {
      const fixture = await deployFixture();
      const { fxrp, shim, payer, payee } = fixture;
      const deadline = FAR_FUTURE;
      const permitSig = await signPermit(fxrp, payer, await shim.getAddress(), SESSION_BUDGET, deadline);
      await fxrp.permit(await payer.getAddress(), await shim.getAddress(), SESSION_BUDGET, deadline, permitSig.v, permitSig.r, permitSig.s);

      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signTransferAuthorization(
        shim,
        payer,
        await payee.getAddress(),
        TICK_VALUE,
        0n,
        FAR_FUTURE,
        nonce,
        "ReceiveWithAuthorization"
      );

      await shim
        .connect(payee)
        .receiveWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s);

      expect(await fxrp.balanceOf(await payee.getAddress())).to.equal(TICK_VALUE);
    });

    it("rejects submission by anyone other than the named payee", async () => {
      const fixture = await deployFixture();
      const { fxrp, shim, payer, payee, stranger } = fixture;
      const deadline = FAR_FUTURE;
      const permitSig = await signPermit(fxrp, payer, await shim.getAddress(), SESSION_BUDGET, deadline);
      await fxrp.permit(await payer.getAddress(), await shim.getAddress(), SESSION_BUDGET, deadline, permitSig.v, permitSig.r, permitSig.s);

      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signTransferAuthorization(
        shim,
        payer,
        await payee.getAddress(),
        TICK_VALUE,
        0n,
        FAR_FUTURE,
        nonce,
        "ReceiveWithAuthorization"
      );

      await expect(
        shim
          .connect(stranger)
          .receiveWithAuthorization(await payer.getAddress(), await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce, sig.v, sig.r, sig.s)
      )
        .to.be.revertedWithCustomError(shim, "CallerMustBePayee")
        .withArgs(await stranger.getAddress(), await payee.getAddress());
    });
  });

  describe("cancelAuthorization", () => {
    it("blocks a nonce from ever being used once canceled", async () => {
      const fixture = await deployFixture();
      const { fxrp, shim, payer, payee, facilitator } = fixture;
      const deadline = FAR_FUTURE;
      const permitSig = await signPermit(fxrp, payer, await shim.getAddress(), SESSION_BUDGET, deadline);
      await fxrp.permit(await payer.getAddress(), await shim.getAddress(), SESSION_BUDGET, deadline, permitSig.v, permitSig.r, permitSig.s);

      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const domain = { name: "FXRP3009", version: "1", chainId, verifyingContract: await shim.getAddress() };
      const types = {
        CancelAuthorization: [
          { name: "authorizer", type: "address" },
          { name: "nonce", type: "bytes32" },
        ],
      };
      const cancelSigRaw = await payer.signTypedData(domain, types, { authorizer: await payer.getAddress(), nonce });
      const cancelSig = ethers.Signature.from(cancelSigRaw);

      await expect(shim.cancelAuthorization(await payer.getAddress(), nonce, cancelSig.v, cancelSig.r, cancelSig.s))
        .to.emit(shim, "AuthorizationCanceled")
        .withArgs(await payer.getAddress(), nonce);

      expect(await shim.authorizationState(await payer.getAddress(), nonce)).to.equal(true);

      const transferSig = await signTransferAuthorization(shim, payer, await payee.getAddress(), TICK_VALUE, 0n, FAR_FUTURE, nonce);
      await expect(
        shim
          .connect(facilitator)
          .transferWithAuthorization(
            await payer.getAddress(),
            await payee.getAddress(),
            TICK_VALUE,
            0n,
            FAR_FUTURE,
            nonce,
            transferSig.v,
            transferSig.r,
            transferSig.s
          )
      ).to.be.revertedWithCustomError(shim, "AuthorizationAlreadyUsed");
    });
  });
});
