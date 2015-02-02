var express = require('express');
//var cool = require('cool-ascii-faces');
var app = express();

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
app.get('/', function(request, response) {
  response.send('Hello World!');
});

app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'));
});


// Require HTTP module (to start server) and Socket.IO
var http = require('http'), io = require('socket.io');

// Start the server at port 8080
var server = http.createServer(function(req, res){ 

	// Send HTML headers and message
	res.writeHead(200,{ 'Content-Type': 'text/html', "Access-Control-Allow-Origin": "*" }); 
	//res.writeHead("Access-Control-Allow-Origin", "*");
	res.end('<h1>Hello Socket Lover!</h1>');
});
server.listen(8080);

// Create a Socket.IO instance, passing it our server
var socket = io.listen(server);
var STATUS = { PLAYING: 1, GAMEOVER: 2 };
var games = { };
var tickrate = 1000 / 66;
var spawns = [ 
		{ x: 21, y: 24 },
		{ x: 291, y: 24 },
		{ x: 561, y: 24 },
		{ x: 561, y: 234 },
		{ x: 561, y: 444 },
		{ x: 291, y: 444 },
		{ x: 21, y: 444 },
		{ x: 21, y: 234 }
	];
createPublicRooms(5);

function createPublicRooms(num) {
	for (var g = 0; g < num; g++) {
		createGame("Public Bomberman Room #" + (g+1), true);
	}
}

// Add a connect listener
socket.on('connection', function(client){ 
	console.log("client connected");
	client.gamePlaying = false;
	//clients.push(client.id);
	client.on('query_rooms', function() {
		client.emit('query_rooms', getRoomList());
	});
	client.on('query_room', function(gameID) {
		if (gameExists(gameID)) {
			client.emit('query_room', getRoomInfo(gameID));
		} else {
			client.emit('query_error', { c: "igi" });
		}
	});
	/*client.on('query', function(gameID) {
		if (gameID !== false) {
			if (gameExists(gameID)) {
				if (games[gameID].players.length < 8) {
					// Return available colors
					client.emit("query", { c: "info", ac: games[gameID].availableColors, pl: games[gameID].names });
				} else {
					// Game is full
					client.emit("query_error", { c: "gif" });
				}
			} else {
				// Invalid Game ID
				client.emit("query_error", { c: "igi" });
			}
			
		} else {
			// Create New Game
			client.emit("query", { c: "cng"});
		}
	});*/
	client.on('createRoom', function(data) {
		var gameRoomNameTrim = data.rt.trim().replace(/ +/g, " ");
		if (isValidGameRoomName(gameRoomNameTrim)) {
			if (isRoomTitleTaken(gameRoomNameTrim)) {
				// Room Name Taken
				client.emit("createRoom_error", { c: "grnt" });
			} else {
				if (isValidName(data.n)) {
					var gameID = createGame(gameRoomNameTrim, false);
					var attemptJoin = playerJoin(gameID, client, data.n, data.c);
					//client.send(games);
					if (attemptJoin == true) {
						client.emit('iniState', { b: getBoard(gameID), ab: [], ae: [] });
						client.emit("createRoom", "Success");
						socket.in(gameID).emit("playerJoin", { n: data.n, c: data.c });
						spawnPlayer(gameID, data.c);
					} else {
						// Color Not Available or Player Name Taken
						client.emit("createRoom_error", attemptJoin);
					}
				} else {
					// Invalid Player Name
					client.emit("createRoom_error", { c: "ipn" });
				}
			}
		} else {
			// Invalid Game Room Name
			client.emit("createRoom_error", { c: "igrn" });
		}
	});
	client.on('joinRoom', function(data) {
		//console.log(data);
		var gameID = data.gameID;
		if (gameExists(gameID)) {
			if (isValidName(data.n)) {
				var attemptJoin = playerJoin(gameID, client, data.n, data.c);
				if (attemptJoin == true) {
					client.emit('gameBoard', getBoard(gameID));
					client.emit("joinRoom", getPlayers(gameID));
					socket.in(gameID).emit("playerJoin", { n: data.n, c: data.c });
					client.emit('abae', { ab: getActiveBombs(gameID), ae: getActiveExplosions(gameID) });
					spawnPlayer(gameID, data.c);
				} else {
					// Color Not Available or Player Name Taken
					client.emit("joinRoom_error", attemptJoin);
				}
			} else {
				// Invalid Player Name
				client.emit("joinRoom_error", { c: "ipn" });
			}

		} else {
			// Invalid Game ID
			client.emit("joinRoom_error", { c: "igi" });
		}
	});
	client.on('spawnReq', function() {
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			if (p.isDead) {
				spawnPlayer(client.gameID, client.gameColor);
			} else {
				client.send('spawnReq_failed');
			}
		}
	});
	client.on('playerDied', function() {
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			p.isDead = true;
			p.score--;
			client.broadcast.to(client.gameID).emit('playerDied', { c: client.gameColor });
		}
	});

	client.on('changeDir', function(data) {
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			console.log(Math.abs((p.x - data.x).toFixed(2)) , Math.abs((p.y - data.y).toFixed(2)));
			if (Math.abs(p.x - data.x) <= 10 && Math.abs(p.y - data.y) <= 10) {
				p.x = data.x;
				p.y = data.y;
				p.dir = data.dir;
				p.altDir = data.altDir;
				p.isStopped = 0;
				client.broadcast.to(client.gameID).emit('changeDir', { d: data, c: client.gameColor });
			} else {
				client.send("hacker!!!!!");
			}
		}
	});
	client.on('stopMoving', function(data) {
		if (games[client.gameID].status == STATUS.PLAYING) {
			console.log("stopMoving: " + data.x);
			var p = getPlayer(client.gameID, client.gameColor);
			if (Math.abs(p.x - data.x) <= 10 && Math.abs(p.y - data.y) <= 10) {
				client.send("you should be at: " + p.x + " and " + p.y);
				p.x = data.x;
				p.y = data.y;
				p.dir = data.dir;
				p.isStopped = 1;
				client.broadcast.to(client.gameID).emit('stopMoving', { d: data, c: client.gameColor });
				//client.send('stopMoving2 ' + data.x);
			} else {
				client.send("stopMoving: hacker!!!!!");
			}
		}
	});
	client.on('chatmsg', function(data) {
		client.broadcast.to(client.gameID).emit('chatmsg', { c: client.gameColor, msg: data });
	});
	client.on('layBomb', function(data) {
		// Calculate the latency from this player to server and player-to-be-sent-to server latency.
		// It will explode in sync for all players.
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			var blockAtLoc = games[client.gameID].board[data.r][data.c].b;
			if (p.nobp < p.noba) {
				var pcentre = getPlayerCentre(p);
				if (pcentre.r == data.r && pcentre.c == data.c && blockAtLoc != "a") {
					p.nobp++;
					games[client.gameID].board[data.r][data.c].b = "a";

					var bomb = { gid: client.gameID, row: data.r, col: data.c, o: p, expStr: p.expStr, ts: 5 - (p.ping / 1000) };
					//var bomb2 = { gid: client.gameID, row: data.r, col: data.c, o: p, expStr: p.expStr };
					//bomb.timer = setTimeout(function() { explode(bomb2); }, 5000 - p.ping);
					games[client.gameID].activeBombs.push(bomb);
					var items = getItemsBehindBricks(bomb);

					//client.broadcast.to(client.gameID).emit('layBomb', { r: data.r, c: data.c, o: client.gameColor, s: client.gameLatency });
					//var playerList = socket.nsps['/'].adapter.rooms[client.gameID];
					var playerList = games[client.gameID].players;
					client.emit('layBomb', { r: data.r, c: data.c, o: p.color, s: p.ping, expStr: p.expStr, i: items });
					for (player in playerList) {
						var socketID = playerList[player].socketID;
						var sync = p.ping + playerList[player].ping;
						client.to(socketID).emit('layBomb', { r: data.r, c: data.c, o: p.color, s: sync, expStr: p.expStr, i: items });
					}
				} else {
					client.send("refused bomb lay, where are you?");
				}
			}
		}
	});
	client.on('debug', function(data) {
		//games[client.gameID].
		//eval(data);
		//console.log("done");
	});
	client.on('pong', function() {
		var p = getPlayer(client.gameID, client.gameColor);
		p.ping = new Date().getTime() - games[client.gameID].latencyLastTS;
		//client.send("Ping is: " + client.gameLatency);
	});

	// Success!  Now listen to messages to be received
	client.on('message',function(event){ 
		console.log('Received message from client!',event);
		//console.log(clients);
	});
	client.on('disconnect',function(){
		//clearInterval(interval);
		playerExit(client);
		console.log('client has disconnected');
		//console.log(client.id);
		//clients.splice(clients.indexOf(client.id),1);
	});

});


function gameLoop(gameID) {
	var game = games[gameID];
	if (game.status == STATUS.PLAYING) {
		var curTS = new Date().getTime();
		game.delta = (curTS - game.deltaLastTS) / 1000;
		game.deltaLastTS = curTS;
		for (var i in game.players) {
			var player = game.players[i];
			// If player is alive.
			if (!player.isDead) {
				if (player.armor > 0) {
					player.armor -= game.delta;
				} else {
					player.armor = 0;
				}
				// if player is moving
				if (!player.isStopped) {
					var calcSpeed = player.speed * game.delta;
					var outOfBoard = isOutOfBoard(player.x, player.y, player.dir, calcSpeed);
					if (!outOfBoard) {
						//console.log("x: " + player.x);
						switch (player.dir) {
							case "u":
								player.y -= calcSpeed;
								break;
							case "d":
								player.y += calcSpeed;
								break;
							case "l":
								player.x -= calcSpeed;
								break;
							case "r":
								player.x += calcSpeed;
								break;
						}
						var centre = getPlayerCentre(player);
						//console.log(centre.r + " " + centre.c);
						var pickedUp = checkIfItemPickup(gameID, player, centre.r, centre.c);
						if (pickedUp !== false) {
							socket.in(gameID).emit('pickedUp', pickedUp);
						} else {
							if (player.armor == 0) {
								var isPD = checkIfPlayerDead(gameID, player, centre.r, centre.c);
								if (isPD !== false) {
									socket.in(gameID).emit('playerDied', isPD);
								}
							}
						}
					} else {
						player.isStopped = 1;
						//console.log("reached board border: " + player.x);
						var data = { x: player.x, y: player.y, dir: player.dir };
						socket.in(gameID).emit('stopMoving', { d: data, c: player.color });
						//socket.in(gameID).send('hi ' + data.x);
					}
				} else {
					// if player has stopped moving
					if (player.armor == 0) {
						//console.log("player armor is 0");
						var centre = getPlayerCentre(player);
						var isPD = checkIfPlayerDead(gameID, player, centre.r, centre.c);
						if (isPD !== false) {
							socket.in(gameID).emit('playerDied', isPD);
						}
					}
				}
			}
		}
		updateActiveBombs(game.delta, gameID);
		updateActiveExplosions(game.delta, gameID);
		game.gameLoopTimer = setTimeout(function() { gameLoop(gameID); }, tickrate);
	}
}

function checkIfPlayerDead(gameID, player, row, col) {
	var item = games[gameID].board[row][col].b;
	if (item == "f" || item == "g" || item == "h") {
		player.isDead = true;
		//console.log(games[gameID].activeExplosions);
		var ae = games[gameID].activeExplosions.filter(function(e) { return (e.row == row && e.col == col); });
		//console.log(ae);
		if (ae.length >= 1) {
			var owner = ae[0].o;
			if (owner.color != player.color) {
				// killed by owner of bomb
				owner.score++;
			} else {
				// suicide
				player.score--;
			}
			return { c: player.color, cb: owner.color };
		}
	} else {
		return false;
	}
}

function playerExit(playerSocket) {
	if (playerSocket.gamePlaying) {
		var gameID = playerSocket.gameID;
		socket.in(gameID).emit('playerLeave', playerSocket.gameColor);
		var game = games[gameID];
		game.names.splice(game.names.indexOf(playerSocket.gameName), 1);
		game.availableColors[playerSocket.gameColor] = true;
		for (var player in game.players) {
			if (game.players[player].name == playerSocket.gameName) { game.players.splice(player,1); break; }
		}
		// If player leaves and room is empty, destroy room only if it's a player created one.
		if (game.players.length == 0 && !game.serverCreated) {
			clearTimeout(games[gameID].pingTimer);
			clearTimeout(games[gameID].gameLoopTimer);
			delete games[gameID];
		}
	}
	return true;
}
function gameExists(gameID) {
	return (typeof games[gameID] !== "undefined");
}
function isRoomTitleTaken(name) {
	for (var gameID in games) {
		if (games[gameID].roomName == name) {
			return true;
		}
	}
	return false;
}



// ********** EXPLOSIONS AND BOMBS


function getItemsBehindBricks(bomb) {
	var row = bomb.row;
	var col = bomb.col;
	var expStr = bomb.o.expStr;
	var items = {};
	if (row > 1) {
		var item = searchForItemsBehindBricks(bomb.gid, expStr, row, col, "u", false);
		if (item !== false) { items["u"] = item; }
	}
	if (row < 15) { 
		var item = searchForItemsBehindBricks(bomb.gid, expStr, row, col, "d", false);
		if (item !== false) { items["d"] = item; }
	}
	if (col > 1) {
		var item = searchForItemsBehindBricks(bomb.gid, expStr, row, col, "l", true);
		if (item !== false) { items["l"] = item; }
	}
	if (col < 19) {
		var item = searchForItemsBehindBricks(bomb.gid, expStr, row, col, "r", true);
		if (item !== false) { items["r"] = item; }
	}
	return items;
}
function searchForItemsBehindBricks(gameID, expStr, row, col, dir, isHorizontal) {
	var newRow = row, newCol = col;
	var item = false;
	for (var n = 1; n <= expStr; n++) {
		newRow = (isHorizontal ? row : (dir =="u" ? newRow - 1 : newRow + 1));
		newCol = (isHorizontal ? (dir =="r" ? newCol + 1 : newCol - 1) : col );
		var block = games[gameID].board[newRow][newCol];
		if (block.b == "w" || block.b == "o") {
			break;
		} else if (block.b == "b" && typeof block.i !== "undefined") {
			item = { r: newRow, c: newCol, i: block.i };
			break;
		}
	}
	return item;
}

function checkExplosions(gameID, row, col) {
	var ae;
	//console.log("checking fire: " + row + " " + col);
	for (var n = games[gameID].activeExplosions.length-1; n >= 0; n--) {
		ae = games[gameID].activeExplosions[n];
		var blockObj = games[gameID].board[ae.row][ae.col];
		//console.log("ae", ae.row, ae.col, blockObj.b);
		if (ae.origRow == row && ae.origCol == col) {
			// check if block being blown up is a brick and has an powerup behind it
			if (typeof blockObj.i !== "undefined") {
				//console.log("brick and item2");
				blockObj.b = blockObj.i;
				delete blockObj.i;
			} else {
				//console.log("empty");
				if (blockObj.b != "a") {
					blockObj.b = "e";
				}
			}
			games[gameID].activeExplosions.splice(n,1);
		}
	}
	if (games[gameID].bricksLeft <= 0) {
		socket.in(gameID).emit('gameOver');
		games[gameID].status = STATUS.GAMEOVER;
		setTimeout(function() { newGame(gameID); }, 5200);
	}
}
function updateActiveBombs(delta, gameID) {
	var ab = games[gameID].activeBombs;
	for (var bomb in ab) {
		ab[bomb].ts -= delta;
		if (ab[bomb].ts <= 0) {
			explode(ab[bomb]);
		}
	}
}
function updateActiveExplosions(delta, gameID) {
	var ae = games[gameID].activeExplosions;
	for (var ex in ae) {
		ae[ex].ts -= delta;
		if (ae[ex].ts <= 0) {
			checkExplosions(gameID, ae[ex].origRow, ae[ex].origCol);
		}
	}
}
function explode(bomb) {
	//f up/down
	// g middle
	// h left/right
	//console.log("exploding: " + bomb);
	var player = bomb.o;
	var expStr = bomb.expStr;
	var row = bomb.row;
	var col = bomb.col;
	var abs = games[bomb.gid].activeBombs;
	player.nobp--;
	for (var n = 0; n < abs.length; n++ ) {
		if (abs[n].row == row && abs[n].col == col) { abs.splice(n,1); break; }
	}
	//console.log("boom");
	addNewExplosion(bomb.gid, row, col, row, col, "g", player);
	if (row > 1) {
		renderExplosion(bomb.gid, expStr, row, col, "u", false, player);
	}
	if (row < 15) { 
		renderExplosion(bomb.gid, expStr, row, col, "d", false, player);
	}
	if (col > 1) {
		renderExplosion(bomb.gid, expStr, row, col, "l", true, player);
	}
	if (col < 19) {
		renderExplosion(bomb.gid, expStr, row, col, "r", true, player);
	}
	//setTimeout(function() { checkExplosions(bomb.gid, row, col); }, 2000);
}
function renderExplosion(gameID, expStr, row, col, dir, isHorizontal, owner) {
	var typeOfFire = (isHorizontal ? "h" : "f");
	var newRow = row, newCol = col;
	for (var n = 1; n <= expStr; n++) {
		newRow = (isHorizontal ? row : (dir =="u" ? newRow - 1 : newRow + 1));
		newCol = (isHorizontal ? (dir =="r" ? newCol + 1 : newCol - 1) : col );
		var block = games[gameID].board[newRow][newCol];
		if (block.b == "w" || block.b == "o") {
			break;
		} else if (block.b == "b") {
			games[gameID].bricksLeft--;
			addNewExplosion(gameID, newRow, newCol, row, col, typeOfFire, owner);
			break;
		} else if (block.b == "a") {
			//console.log("theres a bomb in crossfire");
			//var bombsInCrossfire = $.grep(gameInfo.activeBombs, function(b) { return b.row == newRow && b.col == newCol; });
			var bombsInCrossfire = games[gameID].activeBombs.filter(function(e) { return (e.row == newRow && e.col == newCol); });
			if (bombsInCrossfire.length > 0) {
				for (var bombs in bombsInCrossfire) {
					addNewExplosion(gameID, newRow, newCol, row, col, typeOfFire, owner);
					//clearTimeout(bombsInCrossfire[bombs].timer);
					//var bomb2 = { gid: gameID, row: newRow, col: newCol, expStr: bombsInCrossfire[bombs].expStr, o: bombsInCrossfire[bombs].o };
					//bombsInCrossfire[bombs].timer = setTimeout(function() { explode(bomb2); }, 500);
					if (bombsInCrossfire[bombs].ts > 0.5) {
						bombsInCrossfire[bombs].ts = 0.5;
					}
				}
			}
		} else {
			addNewExplosion(gameID, newRow, newCol, row, col, typeOfFire, owner);
		}
	}
}
function addNewExplosion(gameID, row, col, origRow, origCol, typeOfFire, owner) {
	games[gameID].board[row][col].b = typeOfFire;
	//console.log("ane", row, col, games[gameID].board[row][col].b);
	games[gameID].activeExplosions.push({ row: row, col: col, origRow: origRow, origCol: origCol, o: owner, ts: 2 });
	//console.log("row: " + row + ", col: " + col + ", origRow: " + origRow + ", origCol: " + origCol + ", o: " + owner.color);
}



// ********** END OF EXPLOSIONS/BOMBS






function getBoard(gameID) {
	//return games[gameID].board.map(function(i) { return i.join(""); });
	return games[gameID].board.map(function(e) { return e.map(function(b) { return b.b }).join(""); })
}
function makeBoard(gameID) {
	var board = [];
	board[0] = "ooooooooooooooooooooo";
	board[1] = "oeebbbbbbeeebbbbbbeeo";
	board[2] = "oewbwbwbwbwbwbwbwbweo";
	board[3] = "obbbbbbbbbbbbbbbbbbbo";
	board[4] = "obwbwbwbwbwbwbwbwbwbo";
	board[5] = "obbbbbbbbbbbbbbbbbbbo";
	board[6] = "obwbwbwbwbwbwbwbwbwbo";
	board[7] = "oebbbbbbbbbbbbbbbbbeo";
	board[8] = "oewbwbwbwbwbwbwbwbweo";
	board[9] = "oebbbbbbbbbbbbbbbbbeo";
	board[10] = "obwbwbwbwbwbwbwbwbwbo";
	board[11] = "obbbbbbbbbbbbbbbbbbbo";
	board[12] = "obwbwbwbwbwbwbwbwbwbo";
	board[13] = "obbbbbbbbbbbbbbbbbbbo";
	board[14] = "oewbwbwbwbwbwbwbwbweo";
	board[15] = "oeebbbbbbeeebbbbbbeeo";
	board[16] = "ooooooooooooooooooooo";
	//return board.map(function(cols) { return cols.split(""); });
	board = board.map(function(e) { return e.split("").map(function(x) { return (x == "b" ? createBrickObj() : { b: x }); }); });
	//gameInfo.board.map(function(e) { return e.map(function(x,i) { return (x == "b" ? { b: "b", i: "k" } : { b: x }); }); });
	return board;
}

function checkIfItemPickup(gameID, player, row, col) {
	var board = games[gameID].board;
	var item = board[row][col].b;
	var pickedUp = { r: row, c: col, i: item, p: player.color };
	switch (item) {
		case "s":
			player.speed+=10;
			break;
		case "m":
			player.noba++;
			break;
		case "p":
			player.expStr++;
			break;
		case "i":
			player.armor += 10;
			break;
		default:
			pickedUp = false;
			break;
	}
	if (pickedUp !== false) {
		board[row][col].b = "e";
	}
	return pickedUp;
}

function createBrickObj() {
	var bomb = { b: "b" };
	var rand = Math.floor(Math.random() * 10);
	var prob = ["e", "e", "i", "e", "e", "p", "m", "s", "e", "e" ];
	/*if (rand >= 93) {
		// Speed increase
		bomb.i = "s";
	} else if (rand >= 86) {
		// More bombs
		bomb.i = "m";
	} else if (rand >= 79) {
		// explosion radius increase
		bomb.i = "p";
	} else if (rand >= 74) {
		// temp armor
		bomb.i = "i";
	}*/
	if (prob[rand] != "e") {
		bomb.i = prob[rand];
	}
	return bomb;
}

function getPlayerCentre(player) {
	var w = (player.dir == "u" || player.dir == "d" ? 29 : 20);
	var h = 23;
	var cx = Math.floor((w / 2) + player.x);
	var cy = Math.floor((h / 2) + player.y);
	var row = Math.floor((cy - 20) / 30) + 1;
	var col = Math.floor((cx - 20) / 30) + 1;
	return { r: row, c: col };
}
function isOutOfBoard(x, y, dir, speed) {
	var check;
	var pos;
	var outOfBoard = true;
	switch (dir) {
		case "u":
			check = y - speed;
			pos = Math.floor((check - 20) / 30) + 1;
			if (pos > 0) { outOfBoard = false; }
			break;
		case "d":
			check = y + 23 + speed;
			pos = Math.floor((check - 20) / 30) + 1;
			if (pos < 16) { outOfBoard = false; }
			break;
		case "r":
			check = x + 29 + speed;
			pos = Math.floor((check - 20) / 30) + 1;
			if (pos < 20) { outOfBoard = false; }
			break;
		case "l":
			check = x - speed;
			pos = Math.floor((check - 20) / 30) + 1;
			if (pos > 0) { outOfBoard = false; }
			break;
	}
	console.log("pos: " + pos);
	return outOfBoard;
}
function colorAvailable(gameID, color) {
	return games[gameID].availableColors[color];
}
function isValidName(name) {
	return name.match(/^[A-Za-z]{1}[A-Za-z0-9_\-~+=!@#$%^&*\(\)\[\]]{1,14}$/);
}
function isValidGameRoomName(name) {
	return name.match(/^[A-Za-z]{1}[A-Za-z0-9\\/_\-! @#$'"%^\.&~=*\[\]\(\)+]{5,49}$/);
	//'
}
function playerJoin(gameID, socketObj, name, color) {
	var game = games[gameID];
	if (game.names.indexOf(name) > -1) {
		return { c: "pnt" };
	}
	if (!colorAvailable(gameID,color)) {
		return { c: "cna" };
	}
	game.names.push(name);
	game.players.push({
		socketID: socketObj.id,
		color: color,
		name: name,
		x: 0,
		y: 0,
		ping: 0,
		dir: "d",
		altDir: 0,
		speed: 30,
		isDis: false,
		noba: 1,
		nobp: 0,
		armor: 10,
		isStopped: 1,
		isDead: false,
		expStr: 1,
		score: 0
	});
	game.availableColors[color] = false;
	socketObj.gameID = gameID;
	socketObj.gameName = name;
	socketObj.gameColor = color;
	socketObj.gamePlaying = true;
	//socketObj.gameLatency = 0;
	socketObj.join(gameID);
	//pingPong(socketObj);
	//console.log(game);
	//socketObj.send("playerJoin_b", games[gameID].players);
	return true;
}
function pingPong(gameID) {
	games[gameID].latencyLastTS = new Date().getTime();
	var playerList = games[gameID].players;
	if (playerList.length > 0) {
		var pings = [];
		for (var player in playerList) {
			pings.push({ c: playerList[player].color, p: playerList[player].ping });
		}
		socket.in(gameID).emit('ping', pings);
	}
	games[gameID].pingTimer = setTimeout(function() { pingPong(gameID); }, 5000);
}
function getPlayer(gameID, color) {
	var game = games[gameID];
	for (var player in game.players) {
		if (game.players[player].color == color) {
			return game.players[player];
			break;
		}
	}
	return false;
}
function spawnPlayer(gameID, color) {
	var spawn = { spawn: [] };
	var rand = Math.floor(Math.random() * 8);
	var p = getPlayer(gameID, color);
	if (p != false) {
		var nxny = spawns[rand];
		p.isDead = false;
		p.x = nxny.x;
		p.y = nxny.y;
		p.dir = "d";
		p.speed = 30;
		p.noba = 1;
		p.armor = 10;
		isStopped = 1;
		p.altDir = 0;
		p.nobp = 0;
		p.expStr = 1;
		p.score = 0;
		spawn.spawn.push({ c: p.color, pos: rand });
	}
	socket.in(gameID).emit("spawn", spawn);
}

function newGame(gameID) {
	var game = games[gameID];
	var spawn = { spawn: [] };
	for (var player in game.players) {
		var p = game.players[player];
		var nxny = spawns[player];
		p.isDead = false;
		p.x = nxny.x;
		p.y = nxny.y;
		p.dir = "d";
		p.speed = 30;
		p.noba = 1;
		p.altDir = 0;
		p.armor = 10;
		p.nobp = 0;
		isStopped = 1;
		p.expStr = 1;
		p.score = 0;
		spawn.spawn.push({ c: p.color, pos: player });
	}
	game.activeExplosions = [];
	game.activeBombs = [];
	game.bricksLeft = 198;
	game.board = makeBoard(gameID);
	game.status = STATUS.PLAYING;
	socket.in(gameID).emit("newGame", getBoard(gameID));
	socket.in(gameID).emit("spawn", spawn);
}
function getPlayers(gameID) {
	//return games[gameID].players;
	var players = [];
	var playerList = games[gameID].players;
	for (var p in playerList) {
		var player = playerList[p];
		players.push({
			color: player.color,
			name: player.name,
			x: player.x,
			y: player.y,
			dir: player.dir,
			altDir: player.altDir,
			isDis: player.isDis,
			speed: player.speed,
			noba: player.noba,
			armor: player.armor.toFixed(4),
			nobp: player.nobp,
			ping: player.ping,
			isStopped: player.isStopped,
			isDead: player.isDead,
			expStr: player.expStr,
			score: player.score
		});
	}
	return players;
}
function getRoomList() {
	var rooms = [], roomObj;
	for (var gameID in games) {
		roomObj = {};
		//roomObj.names = games[gameID].names;
		//roomObj.names = [ { n: "PsYcHoX88", s: 5 }, "jokeofweek"];
		roomObj.names = [];
		for (var name in games[gameID].players) {
			var playerInfo = games[gameID].players[name];
			roomObj.names.push({ n: playerInfo.name, s: playerInfo.score });
		}
		roomObj.roomName = games[gameID].roomName;
		roomObj.gameID = gameID;
		roomObj.ac = games[gameID].availableColors;
		rooms.push(roomObj);
	}
	return rooms;
}
function getActiveBombs(gameID) {
	var ab = [];
	for (var bomb in games[gameID].activeBombs) {
		var b = games[gameID].activeBombs[bomb];
		ab.push({ row: b.row, col: b.col, owner: b.o.color, ts: b.ts, expStr: b.expStr, items: getItemsBehindBricks(b) });
	}
	return ab;
}
function getActiveExplosions(gameID) {
	var ae = [];
	for (var exp in games[gameID].activeExplosions) {
		var e = games[gameID].activeExplosions[exp];
		ae.push({ row: e.row, col: e.col, owner: e.o.color, ts: e.ts });
	}
	return ae;
}
function getRoomInfo(gameID) {
	var roomInfo = {};
	roomInfo.names = [];
	for (var name in games[gameID].players) {
		var playerInfo = games[gameID].players[name];
		roomInfo.names.push({ n: playerInfo.name, s: playerInfo.score });
	}
	roomInfo.roomName = games[gameID].roomName;
	roomInfo.gameID = gameID;
	roomInfo.ac = games[gameID].availableColors;
	return roomInfo;
}
function createGame(roomName, isServerCreated) {
	var gameID = createGameID();
	games[gameID] = {
		status: STATUS.PLAYING,
		players: [],
		names: [],
		serverCreated: isServerCreated,
		roomName: roomName,
		delta: 0,
		deltaLastTS: 0,
		gameLoopTimer: setTimeout(function() { gameLoop(gameID); }, tickrate),
		activeExplosions: [],
		activeBombs: [],
		bricksLeft: 198,
		board: makeBoard(gameID),
		availableColors: { pink: true, cyan: true, red: true, yellow: true, blue: true, lime: true, gold: true, green: true }
	};
	pingPong(gameID);
	return gameID;
}
function createGameID() {
	var p = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz", gameID = "";
	for (var n = 0; n < 6; n++) { gameID += p[Math.floor(Math.random() * p.length)]; }
	return gameID;
}