// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArenaRegistry
/// @notice The arena's ledger: who fights, in which generation, with which strategy, and what the
///   lanista attested about it. Gladiators register and enter their own strategies from their own
///   wallets; the lanista (the owner) opens and closes generations, attests scores and promotes.
///   Scores are Aquascan's 5-minute markouts in the quote token, economic fills only, attested
///   here, never recomputed here. The subgraph reads the events; Aquascan reads the subgraph.
contract ArenaRegistry is Ownable {
    struct Gladiator { bytes32 name; uint32 generationBorn; address parent; bool registered; }
    struct Generation { bytes32 tape; uint64 openedAt; uint64 closedAt; address champion; bytes32 championStrategy; int256 championScore; }
    struct Entry { address gladiator; bytes32 strategyHash; bytes32 archetype; }
    struct Score { int256 scoreQuote; int256 seQuote; uint32 fills; address quoteToken; bool attested; }

    event GladiatorRegistered(address indexed gladiator, bytes32 indexed name, uint32 generation, address indexed parent);
    event GenerationOpened(uint32 indexed generation, bytes32 tape, uint64 openedAt);
    event StrategyEntered(address indexed gladiator, bytes32 indexed strategyHash, uint32 indexed generation, bytes32 archetype);
    event Scored(uint32 indexed generation, address indexed gladiator, bytes32 indexed strategyHash, int256 scoreQuote, int256 seQuote, uint32 fills, address quoteToken);
    event GenerationClosed(uint32 indexed generation, address indexed champion, bytes32 championStrategy, int256 scoreQuote);
    event Promoted(address indexed gladiator, bytes32 indexed strategyHash, uint256 chainId, uint256 bankroll);

    error NotRegistered(address gladiator);
    error AlreadyRegistered(address gladiator);
    error NoOpenGeneration();
    error GenerationNotOpen(uint32 generation);
    error GenerationStillOpen(uint32 generation);
    error NotEntered(uint32 generation, address gladiator, bytes32 strategyHash);
    error UnknownParent(address parent);

    mapping(address => Gladiator) public gladiators;
    Generation[] public generations;
    mapping(uint32 => Entry[]) private _entries;
    mapping(uint32 => mapping(bytes32 => Score)) public scores;   // generation => strategy hash => score

    constructor(address lanista) Ownable(lanista) {}

    // ---- gladiators, from their own wallets

    /// @notice A gladiator registers itself, naming the gladiator it descends from, or none.
    function register(bytes32 name, address parent) external {
        require(!gladiators[msg.sender].registered, AlreadyRegistered(msg.sender));
        require(parent == address(0) || gladiators[parent].registered, UnknownParent(parent));
        uint32 generation = uint32(generations.length);
        gladiators[msg.sender] = Gladiator({ name: name, generationBorn: generation, parent: parent, registered: true });
        emit GladiatorRegistered(msg.sender, name, generation, parent);
    }

    /// @notice Enters a strategy the gladiator has shipped to Aqua into the open generation.
    function enter(bytes32 strategyHash, bytes32 archetype) external {
        require(gladiators[msg.sender].registered, NotRegistered(msg.sender));
        uint32 generation = currentGeneration();
        _entries[generation].push(Entry({ gladiator: msg.sender, strategyHash: strategyHash, archetype: archetype }));
        emit StrategyEntered(msg.sender, strategyHash, generation, archetype);
    }

    // ---- the lanista

    function openGeneration(bytes32 tape) external onlyOwner returns (uint32 generation) {
        if (generations.length > 0) require(generations[generations.length - 1].closedAt != 0, GenerationStillOpen(uint32(generations.length - 1)));
        generation = uint32(generations.length);
        generations.push(Generation({ tape: tape, openedAt: uint64(block.timestamp), closedAt: 0, champion: address(0), championStrategy: bytes32(0), championScore: 0 }));
        emit GenerationOpened(generation, tape, uint64(block.timestamp));
    }

    /// @notice Attests a strategy's score for a generation, as Aquascan computed it.
    function score(uint32 generation, address gladiator, bytes32 strategyHash, int256 scoreQuote, int256 seQuote, uint32 fills, address quoteToken) external onlyOwner {
        require(_isEntered(generation, gladiator, strategyHash), NotEntered(generation, gladiator, strategyHash));
        scores[generation][strategyHash] = Score({ scoreQuote: scoreQuote, seQuote: seQuote, fills: fills, quoteToken: quoteToken, attested: true });
        emit Scored(generation, gladiator, strategyHash, scoreQuote, seQuote, fills, quoteToken);
    }

    function closeGeneration(uint32 generation, address champion, bytes32 championStrategy, int256 scoreQuote) external onlyOwner {
        Generation storage g = generations[generation];
        require(g.openedAt != 0 && g.closedAt == 0, GenerationNotOpen(generation));
        if (champion != address(0)) require(_isEntered(generation, champion, championStrategy), NotEntered(generation, champion, championStrategy));
        g.closedAt = uint64(block.timestamp); g.champion = champion; g.championStrategy = championStrategy; g.championScore = scoreQuote;
        emit GenerationClosed(generation, champion, championStrategy, scoreQuote);
    }

    /// @notice The rudis: a champion is granted a real bankroll on a chain. On Base this transaction
    ///   is signed on the Ledger Flex; that tap is the boundary between the gym and the arena.
    function promote(address gladiator, bytes32 strategyHash, uint256 chainId, uint256 bankroll) external onlyOwner {
        require(gladiators[gladiator].registered, NotRegistered(gladiator));
        emit Promoted(gladiator, strategyHash, chainId, bankroll);
    }

    // ---- views

    function currentGeneration() public view returns (uint32) {
        require(generations.length > 0 && generations[generations.length - 1].closedAt == 0, NoOpenGeneration());
        return uint32(generations.length - 1);
    }

    function generationCount() external view returns (uint256) { return generations.length; }

    function entries(uint32 generation) external view returns (Entry[] memory) { return _entries[generation]; }

    function _isEntered(uint32 generation, address gladiator, bytes32 strategyHash) internal view returns (bool) {
        Entry[] storage list = _entries[generation];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].gladiator == gladiator && list[i].strategyHash == strategyHash) return true;
        }
        return false;
    }
}
