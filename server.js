const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/fanpantae', (req, res) => {
    res.sendFile(path.join(__dirname, 'fanpantae.html'));
});

app.get('/matchgame', (req, res) => {
    res.sendFile(path.join(__dirname, 'matchgame.html'));
});

const fs = require('fs');
const rooms = {};
const matchRooms = {};
let questionSets = {}; 
const DATA_FILE = path.join(__dirname, 'data.json');

// โหลดข้อมูลชุดคำถามเมื่อเซิร์ฟเวอร์เริ่มทำงาน
if (fs.existsSync(DATA_FILE)) {
    try {
        const fileData = fs.readFileSync(DATA_FILE, 'utf8');
        questionSets = JSON.parse(fileData);
        console.log(`Loaded ${Object.keys(questionSets).length} question sets from data.json`);
    } catch (e) {
        console.error('Error loading data.json:', e);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('updateSets', Object.keys(questionSets).map(k => ({ id: k, name: questionSets[k].name })));

    socket.on('adminUpload', (data, callback) => {
        if (data.password === "290245" || data.password === "260245") {
            const setId = "set_" + Date.now();
            questionSets[setId] = {
                id: setId,
                name: data.setName,
                questions: data.questions
            };
            fs.writeFileSync(DATA_FILE, JSON.stringify(questionSets, null, 2));
            
            console.log("Uploaded Set:", data.setName);
            console.log("First Question:", data.questions[0]);
            
            io.emit('updateSets', Object.values(questionSets).map(s => ({ id: s.id, name: s.name })));
            callback({ success: true, message: "อัปโหลดและบันทึกชุดคำถามสำเร็จ!" });
        } else {
            callback({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });
        }
    });

    socket.on('getSetsData', (password, callback) => {
        if (password === "290245" || password === "260245") {
            callback({ success: true, data: questionSets });
        } else {
            callback({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });
        }
    });

    socket.on('saveSetData', (data, callback) => {
        if (data.password === "290245" || data.password === "260245") {
            if (data.setId && questionSets[data.setId]) {
                questionSets[data.setId] = data.setInfo;
                fs.writeFileSync(DATA_FILE, JSON.stringify(questionSets, null, 2));
                io.emit('updateSets', Object.values(questionSets).map(s => ({ id: s.id, name: s.name })));
                callback({ success: true });
            } else callback({ success: false, message: "ไม่พบชุดคำถามนี้" });
        } else {
            callback({ success: false, message: "รหัสผ่านแอดมินไม่ถูกต้อง" });
        }
    });

    socket.on('deleteSet', (data, callback) => {
        if (data.password === "290245" || data.password === "260245") {
            if (data.setId && questionSets[data.setId]) {
                delete questionSets[data.setId];
                fs.writeFileSync(DATA_FILE, JSON.stringify(questionSets, null, 2));
                io.emit('updateSets', Object.values(questionSets).map(s => ({ id: s.id, name: s.name })));
                callback({ success: true });
            } else callback({ success: false, message: "ไม่พบชุดคำถามนี้" });
        }
    });

    socket.on('createRoom', (data, callback) => {
        const { roomId, hostName, setId, mode, timeLimit, mistakeLimit } = data;
        rooms[roomId] = {
            host: socket.id,
            hostName: hostName,
            setId: setId,
            mode: mode || 'multi',
            timeLimit: parseInt(timeLimit) || 10,
            mistakeLimit: parseInt(mistakeLimit) || 3,
            mistakes: 0,
            timer: null,
            status: "waiting",
            players: {}, 
            currentQuestionIndex: -1
        };
        rooms[roomId].players[socket.id] = { id: socket.id, name: hostName, isHost: true, score: 0, hasAnswered: false };
        
        socket.join(roomId);
        callback({ success: true });
    });

    socket.on('joinRoom', (data, callback) => {
        const { roomId, playerName } = data;
        const room = rooms[roomId];
        
        if (room && room.status === "waiting") {
            if (room.mode === 'single' && Object.keys(room.players).length >= 2) {
                // length >= 2 because 1 is the Host, so 2nd is the player. If >= 2, there is already 1 player.
                return callback({ success: false, message: "ห้องเล่นคนเดียวนี้มีผู้เล่นครบแล้ว!" });
            }
            
            room.players[socket.id] = { id: socket.id, name: playerName, isHost: false, score: 0, hasAnswered: false };
            socket.join(roomId);
            io.to(roomId).emit('playerJoined', { players: Object.values(room.players) });
            callback({ success: true, setId: room.setId });
        } else {
            callback({ success: false, message: "ไม่พบห้องนี้ หรือเกมเริ่มไปแล้ว!" });
        }
    });

    function sendQuestion(roomId) {
        const room = rooms[roomId];
        const set = questionSets[room.setId];
        
        if (!set || room.currentQuestionIndex >= set.questions.length) {
            io.to(roomId).emit('gameOver', { players: Object.values(room.players) });
            return;
        }
        
        Object.values(room.players).forEach(p => {
            p.hasAnswered = false;
        });

        const q = set.questions[room.currentQuestionIndex];
        
        const choices = [
            { text: q.c1, isCorrect: true },
            { text: q.c2, isCorrect: false },
            { text: q.c3, isCorrect: false },
            { text: q.c4, isCorrect: false }
        ].filter(c => c.text); 

        choices.sort(() => Math.random() - 0.5); 

        io.to(roomId).emit('newQuestion', {
            qIndex: room.currentQuestionIndex + 1,
            total: set.questions.length,
            question: q.q,
            choices: choices.map(c => c.text),
            mode: room.mode,
            timeLimit: room.timeLimit
        });

        if (room.timer) clearTimeout(room.timer);
        if (room.mode === 'single') {
            room.timer = setTimeout(() => {
                handleSinglePlayerMistake(roomId, "หมดเวลา!");
            }, room.timeLimit * 1000);
        }
    }

    function handleSinglePlayerMistake(roomId, reasonMsg) {
        const room = rooms[roomId];
        if(!room || room.status !== 'playing') return;
        
        room.mistakes++;
        io.to(roomId).emit('wrongAnswer'); 
        io.to(roomId).emit('playerAnsweredWrong', { playerName: "คุณ" });

        if (room.mistakes >= room.mistakeLimit) {
            room.status = "ended";
            io.to(roomId).emit('gameOver', { reason: "mistakes", players: Object.values(room.players), mistakes: room.mistakes });
        } else {
            room.status = "waiting_next";
            io.to(roomId).emit('roundWinner', { 
                winnerName: "ไม่มีใคร", 
                correctAnswer: questionSets[room.setId].questions[room.currentQuestionIndex].c1,
                winnerScore: 0,
                winnerId: null
            });
            setTimeout(() => {
                if (rooms[roomId]) {
                    rooms[roomId].currentQuestionIndex++;
                    rooms[roomId].status = "playing";
                    sendQuestion(roomId);
                }
            }, 5000);
        }
    }

    socket.on('startGame', (roomId) => {
        if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].status = "playing";
            rooms[roomId].currentQuestionIndex = 0;
            sendQuestion(roomId);
            
            const currentScores = Object.values(rooms[roomId].players).filter(p => !p.isHost).map(p => ({ name: p.name, score: p.score }));
            io.to(roomId).emit('updateLiveScores', currentScores);
        }
    });

    socket.on('submitAnswer', (data) => {
        const { roomId, answer } = data;
        const room = rooms[roomId];
        
        if (room && room.players[socket.id] && room.status === "playing") {
            if (room.timer) {
                clearTimeout(room.timer);
                room.timer = null;
            }
            
            const set = questionSets[room.setId];
            const q = set.questions[room.currentQuestionIndex];
            const player = room.players[socket.id];
            
            if (player.hasAnswered) return; // กันตอบซ้ำ
            player.hasAnswered = true;
            
            const isCorrect = (answer === q.c1);
            if (isCorrect) {
                player.score += 10;
                room.status = "waiting_next";
                
                io.to(roomId).emit('roundWinner', { 
                    winnerName: player.name, 
                    correctAnswer: q.c1,
                    winnerScore: player.score,
                    winnerId: socket.id
                });
                
                const currentScores = Object.values(room.players).filter(p => !p.isHost).map(p => ({ name: p.name, score: p.score }));
                io.to(roomId).emit('updateLiveScores', currentScores);
                
                setTimeout(() => {
                    if (rooms[roomId]) {
                        rooms[roomId].currentQuestionIndex++;
                        rooms[roomId].status = "playing";
                        sendQuestion(roomId);
                    }
                }, 5000);
            } else {
                if (room.mode === 'single') {
                    handleSinglePlayerMistake(roomId, "ตอบผิด!");
                } else {
                    // ตอบผิด โหมดเล่นหลายคน
                    socket.emit('wrongAnswer');
                    io.to(roomId).emit('playerAnsweredWrong', { playerName: player.name });
                    
                    const nonHostPlayers = Object.values(room.players).filter(p => !p.isHost);
                    const allAnswered = nonHostPlayers.every(p => p.hasAnswered);
                    
                    if (allAnswered && room.status === "playing") {
                        room.status = "waiting_next";
                        io.to(roomId).emit('roundWinner', { 
                            winnerName: "ไม่มีใคร", 
                            correctAnswer: q.c1,
                            winnerScore: 0,
                            winnerId: null
                        });
                        
                        setTimeout(() => {
                            if (rooms[roomId]) {
                                rooms[roomId].currentQuestionIndex++;
                                rooms[roomId].status = "playing";
                                sendQuestion(roomId);
                            }
                        }, 5000);
                    }
                }
            }
        }
    });
    // ==========================================
    // เกมจับคู่ไพ่ (Match Game)
    // ==========================================
    socket.on('match_createRoom', (data, callback) => {
        const roomId = 'M' + Math.floor(1000 + Math.random() * 9000);
        const emojis = ["🏥","💰","👶","🦷","🦽","⚰️","🧓","📉","💊","🏢"];
        let pairsNeeded = parseInt(data.cardCount) / 2;
        let selected = emojis.slice(0, pairsNeeded);
        let deck = [...selected, ...selected];
        deck.sort(() => Math.random() - 0.5);

        matchRooms[roomId] = {
            id: roomId, host: socket.id, mode: data.mode,
            timeLimit: parseInt(data.timeLimit),
            mistakeLimit: parseInt(data.mistakeLimit),
            mistakes: 0, matchedPairs: 0, totalPairs: pairsNeeded,
            cards: deck.map((icon, i) => ({ id: i, icon, isMatched: false })),
            players: [], // โฮสต์ไม่ถูกใส่ใน players แล้ว
            status: 'waiting', currentTurnIndex: 0, flipped: []
        };
        socket.join(roomId);
        callback({ success: true, roomId });
    });

    socket.on('match_joinRoom', (data, callback) => {
        const { roomId, playerName } = data;
        const room = matchRooms[roomId];
        if (room && room.status === 'waiting') {
            if (room.mode === 'single' && room.players.length >= 1) {
                return callback({ success: false, message: "ห้องเล่นคนเดียวนี้มีผู้เล่นเต็มแล้ว" });
            }
            room.players.push({ id: socket.id, name: playerName, score: 0 });
            socket.join(roomId);
            io.to(roomId).emit('match_updatePlayers', room.players);
            callback({ success: true });
        } else {
            callback({ success: false, message: "ห้องไม่พร้อม หรือเริ่มเกมไปแล้ว" });
        }
    });

    socket.on('match_startGame', (roomId) => {
        const room = matchRooms[roomId];
        if (room && room.host === socket.id) {
            if (room.players.length === 0) {
                return; // ต้องมีผู้เล่น
            }
            room.status = 'playing';
            io.to(roomId).emit('match_gameStarted', getMatchState(room));
        }
    });

    socket.on('match_flip', (data) => {
        const room = matchRooms[data.roomId];
        if (!room || room.status !== 'playing') return;
        
        // Check turn (โฮสต์ห้ามกด)
        if (room.host === socket.id) return; 

        if (room.mode === 'multi') {
            if (room.players[room.currentTurnIndex].id !== socket.id) return;
        } else {
            if (room.players[0].id !== socket.id) return;
        }

        const card = room.cards.find(c => c.id === data.cardId);
        if (!card || card.isMatched || room.flipped.includes(card.id)) return;

        room.flipped.push(card.id);
        io.to(data.roomId).emit('match_cardFlipped', { cardId: card.id, icon: card.icon, who: socket.id });

        if (room.flipped.length === 2) {
            const [c1Id, c2Id] = room.flipped;
            const c1 = room.cards.find(c => c.id === c1Id);
            const c2 = room.cards.find(c => c.id === c2Id);
            
            const isMatch = (c1.icon === c2.icon);
            room.flipped = []; // reset for next action
            
            if (isMatch) {
                c1.isMatched = true; c2.isMatched = true;
                room.matchedPairs++;
                
                if (room.mode === 'multi') {
                    room.players[room.currentTurnIndex].score++;
                    // Turn does not advance, play again!
                }
            } else {
                if (room.mode === 'single') room.mistakes++;
                else {
                    // Multi: next player turn
                    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
                }
            }
            
            // Broadcast match result and new turn state
            io.to(data.roomId).emit('match_result', {
                success: isMatch,
                cards: [c1Id, c2Id],
                state: getMatchState(room)
            });

            // Check End Game
            if (room.matchedPairs === room.totalPairs) {
                room.status = 'ended';
                io.to(data.roomId).emit('match_gameOver', { win: true, mistakes: room.mistakes, mode: room.mode, players: room.players });
            } else if (room.mode === 'single' && room.mistakes >= room.mistakeLimit) {
                room.status = 'ended';
                io.to(data.roomId).emit('match_gameOver', { win: false, reason: 'mistakes', mode: 'single' });
            }
        }
    });

    socket.on('match_timeUp', (roomId) => {
        const room = matchRooms[roomId];
        if (room && room.mode === 'single' && room.status === 'playing') {
            room.status = 'ended';
            io.to(roomId).emit('match_gameOver', { win: false, reason: 'time', mode: 'single' });
        }
    });

    function getMatchState(room) {
        return {
            mode: room.mode, cards: room.cards.map(c => ({ id: c.id, isMatched: c.isMatched, icon: c.isMatched ? c.icon : '' })),
            players: room.players, currentTurnIndex: room.currentTurnIndex,
            timeLimit: room.timeLimit, mistakeLimit: room.mistakeLimit, mistakes: room.mistakes,
            matchedPairs: room.matchedPairs, totalPairs: room.totalPairs
        };
    }

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`เซิร์ฟเวอร์รันสำเร็จแล้ว! ที่พอร์ต ${PORT}`);
    console.log(`===========================================`);
});
