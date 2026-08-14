/**
 * Addresses, chains and ABIs, all confirmed on-chain rather than copied from docs.
 *
 * The FXRP addresses were checked on both networks by calling them: `nonces` answers
 * (EIP-2612 present) and `authorizationState` reverts (EIP-3009 absent). That gap is
 * the reason this package exists.
 */
import { type Chain, type Hex } from "viem";
export type FlareChainId = 114 | 14;
export declare const coston2: Chain;
export declare const flare: Chain;
export declare const CHAINS: Record<FlareChainId, Chain>;
/** FXRP (FAssets) proxy addresses. */
export declare const FXRP_ADDRESS: Record<FlareChainId, Hex>;
/** Deployed FXRP3009 shims, source-verified on each network's explorer. */
export declare const FXRP3009_ADDRESS: Record<FlareChainId, Hex>;
export declare const FXRP_DECIMALS = 6;
export declare const ERC20_ABI: readonly [{
    readonly type: "function";
    readonly name: "balanceOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "allowance";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }, {
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "nonces";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "permit";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint256";
    }, {
        readonly name: "v";
        readonly type: "uint8";
    }, {
        readonly name: "r";
        readonly type: "bytes32";
    }, {
        readonly name: "s";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}];
/** The shim's own surface: standard EIP-3009, plus a mirrored Transfer (see README). */
export declare const FXRP3009_ABI: readonly [{
    readonly type: "function";
    readonly name: "transferWithAuthorization";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
    }, {
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "validAfter";
        readonly type: "uint256";
    }, {
        readonly name: "validBefore";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }, {
        readonly name: "v";
        readonly type: "uint8";
    }, {
        readonly name: "r";
        readonly type: "bytes32";
    }, {
        readonly name: "s";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "receiveWithAuthorization";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
    }, {
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "validAfter";
        readonly type: "uint256";
    }, {
        readonly name: "validBefore";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }, {
        readonly name: "v";
        readonly type: "uint8";
    }, {
        readonly name: "r";
        readonly type: "bytes32";
    }, {
        readonly name: "s";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "cancelAuthorization";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "authorizer";
        readonly type: "address";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }, {
        readonly name: "v";
        readonly type: "uint8";
    }, {
        readonly name: "r";
        readonly type: "bytes32";
    }, {
        readonly name: "s";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "authorizationState";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
    }, {
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly type: "function";
    readonly name: "token";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly type: "event";
    readonly name: "AuthorizationUsed";
    readonly inputs: readonly [{
        readonly name: "authorizer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
        readonly indexed: true;
    }];
}, {
    readonly type: "event";
    readonly name: "Transfer";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "value";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}];
export declare const PERMIT_TYPES: {
    readonly Permit: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "deadline";
        readonly type: "uint256";
    }];
};
export declare const TRANSFER_AUTH_TYPES: {
    readonly TransferWithAuthorization: readonly [{
        readonly name: "from";
        readonly type: "address";
    }, {
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "validAfter";
        readonly type: "uint256";
    }, {
        readonly name: "validBefore";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "bytes32";
    }];
};
