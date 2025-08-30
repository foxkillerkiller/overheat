/**
 * @fileoverview 热力对决游戏核心逻辑
 * @license GPL-3.0
 * 
 * 核心规则：
 * 1. 双方有血量和热量，上限100。
 * 2. 热量决定本回合伤害倍率（heat/100）和减伤倍率（1 - heat/100）。
 * 3. 热量 > 100 时过热：跳过下回合，清空热量，增益清零。
 * 4. 攻击方热量 - 防御方热量 > 50 时，防御方获得插入攻击回合。
 * 5. 所有的攻防卡牌都在管理敌我双方热量
 */

class HeatDuelGame {
    constructor(player1Deck, player2Deck, mode = 'classic') {
        // 游戏状态
        this.state = {
            players: {
                p1: { hp: 100, heat: 0, skipped: false, hand: [], deck: [...player1Deck] },
                p2: { hp: 100, heat: 0, skipped: false, hand: [], deck: [...player2Deck] }
            },
            turn: 'p1', // 'p1' 或 'p2'，表示当前主动回合方
            phase: 'start', // 'start', 'action', 'defense', 'insert', 'end'
            mode: mode, // 'classic' 或 'simultaneous'
            log: [] // 游戏日志
        };

        this._log('游戏初始化完毕。模式: ' + mode);
    }

    /**
     * 开始一个回合
     */
    startTurn() {
        const activePlayer = this.state.turn;
        const opponent = activePlayer === 'p1' ? 'p2' : 'p1';

        this.state.phase = 'start';

        // 检查跳过状态
        if (this.state.players[activePlayer].skipped) {
            this._log(`${activePlayer} 因过热跳过回合！`);
            this.state.players[activePlayer].skipped = false;
            this._endTurn();
            return;
        }

        // 抽牌逻辑（简化：这里假设每回合抽一张）
        this._drawCard(activePlayer);
        this._drawCard(opponent);

        this._log(`=== ${activePlayer} 的回合开始 ===`);
        this.state.phase = 'action';
    }

    /**
     * 玩家出牌（经典模式）
     * @param {string} playerId 玩家ID
     * @param {number} cardIndex 手牌索引
     */
    playCard(playerId, cardIndex) {
        if (this.state.mode !== 'classic') {
            throw new Error('此方法仅适用于经典模式');
        }

        const player = this.state.players[playerId];
        const card = player.hand[cardIndex];

        if (!card) {
            throw new Error('无效的卡牌');
        }

        // 从手牌移除
        player.hand.splice(cardIndex, 1);

        this._log(`${playerId} 打出 [${card.name}]`);

        // 应用卡牌效果
        this._applyCardEffects(playerId, card);

        // 经典模式：如果是攻击方出完牌，轮到防御方
        if (this.state.phase === 'action' && playerId === this.state.turn) {
            this.state.phase = 'defense';
            this._log(`轮到 ${this._getOpponent(playerId)} 进行防御。`);
        }
        // 防御方出完牌，进行结算
        else if (this.state.phase === 'defense' && playerId !== this.state.turn) {
            this._resolveTurn();
        }
    }

    /**
     * 同时模式出牌
     * @param {string} playerId 玩家ID
     * @param {number} cardIndex 手牌索引
     */
    playCardSimultaneous(playerId, cardIndex) {
        if (this.state.mode !== 'simultaneous') {
            throw new Error('此方法仅适用于同时模式');
        }

        const player = this.state.players[playerId];
        const card = player.hand[cardIndex];

        if (!card) {
            throw new Error('无效的卡牌');
        }

        // 存储选择（在实际实现中，需要等待双方都选择后再揭示）
        player.selectedCard = card;
        player.hand.splice(cardIndex, 1);

        this._log(`${playerId} 选择了卡牌`);

        // 检查是否双方都已完成选择
        if (this.state.players.p1.selectedCard && this.state.players.p2.selectedCard) {
            this._resolveSimultaneousTurn();
        }
    }

    /**
     * 解析同时模式回合
     */
    _resolveSimultaneousTurn() {
        const p1Card = this.state.players.p1.selectedCard;
        const p2Card = this.state.players.p2.selectedCard;

        this._log(`揭示: p1 打出 [${p1Card.name}], p2 打出 [${p2Card.name}]`);

        // 攻对攻
        if (p1Card.type === 'attack' && p2Card.type === 'attack') {
            this._log(`攻对攻！双方互相伤害！`);
            this._applyCardEffects('p1', p1Card);
            this._applyCardEffects('p2', p2Card);
        }
        // 攻对防
        else if (p1Card.type === 'attack' && p2Card.type === 'defense') {
            this._log(`p1 攻击, p2 防御！`);
            this._applyCardEffects('p1', p1Card);
            this._applyCardEffects('p2', p2Card);
            
            // 检查插入回合
            this._checkInsertTurn('p1', 'p2');
        }
        // 防对攻
        else if (p1Card.type === 'defense' && p2Card.type === 'attack') {
            this._log(`p2 攻击, p1 防御！`);
            this._applyCardEffects('p1', p1Card);
            this._applyCardEffects('p2', p2Card);
            
            // 检查插入回合
            this._checkInsertTurn('p2', 'p1');
        }
        // 防对防
        else {
            this._log(`双方都防御，无人受伤。`);
            this._applyCardEffects('p1', p1Card);
            this._applyCardEffects('p2', p2Card);
        }

        // 清理选择
        delete this.state.players.p1.selectedCard;
        delete this.state.players.p2.selectedCard;

        // 过热检查
        this._checkOverheat('p1');
        this._checkOverheat('p2');

        this._endTurn();
    }

    /**
     * 解析经典模式回合
     */
    _resolveTurn() {
        const activePlayer = this.state.turn;
        const opponent = this._getOpponent(activePlayer);

        // 检查插入回合
        this._checkInsertTurn(activePlayer, opponent);

        // 过热检查
        this._checkOverheat(activePlayer);
        this._checkOverheat(opponent);

        this._endTurn();
    }

    /**
     * 检查并执行插入回合
     */
    _checkInsertTurn(attacker, defender) {
        const att = this.state.players[attacker];
        const def = this.state.players[defender];

        const heatDiff = att.heat - def.heat;
        
        if (heatDiff > 50) {
            this._log(`${defender} 因热量差(${heatDiff} > 50)获得插入攻击回合！`);
            
            // 简化：假设防御方总是能打出一张攻击牌
            const attackCard = this._findAttackCard(defender);
            if (attackCard) {
                this._log(`${defender} 插入攻击: [${attackCard.name}]`);
                this._applyCardEffects(defender, attackCard, true); // true 表示是插入攻击
            }
        }
    }

    /**
     * 应用卡牌效果
     */
    _applyCardEffects(playerId, card, isInsertAttack = false) {
        const player = this.state.players[playerId];
        const opponentId = this._getOpponent(playerId);
        const opponent = this.state.players[opponentId];

        // 处理热量变化
        if (card.heatChange) {
            player.heat += card.heatChange;
            this._log(`${playerId} 热量 ${card.heatChange > 0 ? '+' : ''}${card.heatChange} = ${player.heat}`);
        }

        // 处理伤害
        if (card.damage && card.type === 'attack') {
            // 计算攻击倍率
            const attackMultiplier = player.heat / 100;
            let finalDamage = card.damage * attackMultiplier;

            // 计算防御倍率（如果是插入攻击，使用当前热量；否则是正常流程）
            const defenseMultiplier = 1 - (isInsertAttack ? opponent.heat : player.heat) / 100;
            finalDamage *= defenseMultiplier;

            // 应用护盾（如果有）
            // 简化：这里假设卡牌可能提供护盾，但需要更复杂的实现

            finalDamage = Math.max(0, Math.floor(finalDamage));
            opponent.hp -= finalDamage;

            this._log(`${playerId} 对 ${opponentId} 造成 ${finalDamage} 点伤害! (原始: ${card.damage}, 攻倍: ${attackMultiplier.toFixed(2)}, 防倍: ${defenseMultiplier.toFixed(2)})`);
        }

        // 处理治疗/护盾
        if (card.heal) {
            player.hp = Math.min(100, player.hp + card.heal);
            this._log(`${playerId} 治疗 ${card.heal} 点, HP: ${player.hp}`);
        }

        // 处理其他效果...
    }

    /**
     * 检查过热状态
     */
    _checkOverheat(playerId) {
        const player = this.state.players[playerId];
        
        if (player.heat > 100) {
            this._log(`${playerId} 过热！跳过下回合，热量清零。`);
            player.skipped = true;
            player.heat = 0;
        }
    }

    /**
     * 结束当前回合
     */
    _endTurn() {
        this._log(`=== ${this.state.turn} 的回合结束 ===`);
        
        // 切换回合
        this.state.turn = this.state.turn === 'p1' ? 'p2' : 'p1';
        this.state.phase = 'end';

        // 检查游戏结束
        if (this._checkGameOver()) {
            this._log('游戏结束！');
            return;
        }

        // 下一回合开始
        setTimeout(() => this.startTurn(), 1000);
    }

    /**
     * 检查游戏是否结束
     */
    _checkGameOver() {
        if (this.state.players.p1.hp <= 0) {
            this._log('p2 获胜！');
            return true;
        }
        if (this.state.players.p2.hp <= 0) {
            this._log('p1 获胜！');
            return true;
        }
        return false;
    }

    /**
     * 辅助方法：获取对手ID
     */
    _getOpponent(playerId) {
        return playerId === 'p1' ? 'p2' : 'p1';
    }

    /**
     * 辅助方法：抽牌
     */
    _drawCard(playerId) {
        const player = this.state.players[playerId];
        if (player.deck.length > 0) {
            const card = player.deck.shift();
            player.hand.push(card);
            this._log(`${playerId} 抽到一张牌: [${card.name}]`);
        }
    }

    /**
     * 辅助方法：查找攻击牌（简化实现）
     */
    _findAttackCard(playerId) {
        const player = this.state.players[playerId];
        return player.hand.find(card => card.type === 'attack') || null;
    }

    /**
     * 辅助方法：添加日志
     */
    _log(message) {
        this.state.log.push(message);
        console.log(message);
    }
}

// 示例卡牌定义
const exampleCards = [
    { name: '重击', type: 'attack', damage: 25, heatChange: 30 },
    { name: '快刺', type: 'attack', damage: 10, heatChange: 10 },
    { name: '格挡', type: 'defense', heatChange: -20 },
    { name: '散热', type: 'defense', heatChange: -40 }
];

// 使用示例
const player1Deck = [...exampleCards, ...exampleCards]; // 简单复制两份作为卡组
const player2Deck = [...exampleCards, ...exampleCards];

// 创建游戏实例
const game = new HeatDuelGame(player1Deck, player2Deck, 'classic');

// 开始游戏
game.startTurn();

// 在经典模式下，需要按顺序出牌：
// game.playCard('p1', 0); // p1 出第一张牌
// game.playCard('p2', 0); // p2 出第一张牌