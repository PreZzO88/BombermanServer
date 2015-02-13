var http = require("http");
var express = require("express");
var app = express();

// Fix Cross-Origin-Policy
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', 'http://qlinstaranks.com');
  res.header('Access-Control-Allow-Credentials', true);
  return next();
});
var port = process.env.PORT || 5000;

app.use(express.static(__dirname + "/"));

// Create server and listen on port.
var server = http.createServer(app);
server.listen(port);

console.log("http server listening on %d", port);

var io = require('socket.io');
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
createPublicRooms(1);

// Create Public Rooms.
function createPublicRooms(num) {
	for (var g = 0; g < num; g++) {
		createGame("Public Bomberman Room #" + (g+1), true);
	}
}

// Add a connect listener
socket.on('connection', function(client){ 

	client.gamePlaying = false;
	client.join('bmlobby');

	// Player queries room list.
	client.on('query_rooms', function() {
		client.emit('query_rooms', getRoomList());
	});

	// Player queries room information for specific room.
	client.on('query_room', function(gameID) {
		if (gameExists(gameID)) {
			client.emit('query_room', getRoomInfo(gameID));
		} else {
			client.emit('query_error', { c: "igi" });
		}
	});

	// When a player creates a room.
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
						client.leave('bmlobby');
						socket.in('bmlobby').emit('lobbyUpd_newRoom', getRoomInfo(gameID));
						client.emit('gameBoard', getBoard(gameID));
						client.emit("createRoom", "Success");
						socket.in(gameID).emit("playerJoin", { n: data.n, c: data.c });
						client.emit('abae', { ab: [], ae: [] });
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

	// When player joins a room.
	client.on('joinRoom', function(data) {
		//console.log(data);
		var gameID = data.gameID;
		if (gameExists(gameID)) {
			if (isValidName(data.n)) {
				var attemptJoin = playerJoin(gameID, client, data.n, data.c);
				if (attemptJoin == true) {
					client.leave('bmlobby');
					socket.in('bmlobby').emit('lobbyUpd_roomInfo', getRoomInfo(gameID));
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

	// When player requests to spawn.
	client.on('spawnReq', function() {
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			if (p.isDead) {
				spawnPlayer(client.gameID, client.gameColor);
			}
		}
	});

	// When player starts moving or changes direction.
	client.on('changeDir', function(data) {
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			p.changingDir = (p.dir != data.dir ? true : false);
			p.broadcastedMoving = false;
			p.sentRate = 0.500;
			//p.x = data.x;
			//p.y = data.y;
			p.dir = data.dir;
			p.altDir = data.altDir;
			p.isStopped = false;
		}
	});

	// When player stops moving.
	client.on('stopMoving', function(data) {
		if (games[client.gameID].status == STATUS.PLAYING) {
			//console.log("stopMoving: " + data.x);
			var p = getPlayer(client.gameID, client.gameColor);
			//client.send("you should be at: " + p.x + " and " + p.y);
			//var newX = p.x + (((p.ping / 2) / 1000) * p.speed);
			//client.send("you should be at: " + p.x + " and " + p.y);
			//client.send("you should be at (ping corrected) only going left test: " + newX);
			//p.x = data.x;
			//p.y = data.y;
			//p.dir = data.dir;
			if (!p.isStopped) {
				socket.in(client.gameID).emit('stopMoving', { d: { x: p.x, y: p.y, dir: p.dir }, c: p.color });
				p.isStopped = true;
			}
			//client.send('stopMoving2 ' + data.x);
		}
	});

	client.on('debug', function() {
		var a = games[client.gameID].board;
		games[client.gameID].board = [];
		console.log(games[client.gameID]);
		games[client.gameID].board = a;
	});



	// Chat message received and broadcast.
	client.on('chatmsg', function(data) {
		client.broadcast.to(client.gameID).emit('chatmsg', { c: client.gameColor, msg: data.substr(0,300) });
	});

	// When a player lays a bomb.
	client.on('layBomb', function(data) {
		// Calculate the latency from this player to server and player-to-be-sent-to server latency.
		// It will explode in sync for all players.
		if (games[client.gameID].status == STATUS.PLAYING) {
			var p = getPlayer(client.gameID, client.gameColor);
			var blockAtLoc = games[client.gameID].board[data.r][data.c].b;
			if (p.nobp < p.noba) {
				var pcentre = p.c;
				var centerRow = Math.floor((pcentre.y - 20) / 30) + 1;
				var centerCol = Math.floor((pcentre.x - 20) / 30) + 1;	
				if (centerRow == data.r && centerCol == data.c && blockAtLoc != "a") {
					p.nobp++;
					games[client.gameID].board[data.r][data.c].b = "a";
					p.lastLay = { r: data.r, c: data.c };
					var bomb = { gid: client.gameID, row: data.r, col: data.c, o: p, expStr: p.expStr, ts: 5 - (p.ping / 1000) };
					games[client.gameID].activeBombs.push(bomb);

					var items = getItemsBehindBricks(bomb);
					var playerList = games[client.gameID].players;
					client.emit('layBomb', { r: data.r, c: data.c, o: p.color, s: p.ping, expStr: p.expStr, i: items });
					for (player in playerList) {
						var socketID = playerList[player].socketID;
						var sync = p.ping + playerList[player].ping;
						client.to(socketID).emit('layBomb', { r: data.r, c: data.c, o: p.color, s: sync, expStr: p.expStr, i: items });
					}
				}
			}
		}
	});
	
	// Used to calculate latency (2-way).
	client.on('pong', function() {
		var p = getPlayer(client.gameID, client.gameColor);
		p.ping = new Date().getTime() - games[client.gameID].latencyLastTS;
		//client.send("Ping is: " + client.gameLatency);
	});

	// Player voluntarily left game.
	client.on('playerLeave', function() {
		playerExit(client);
		client.leave(client.gameID);
	});
	// When player closes his tab/browser/internet connection breaks (socket disconnect).
	client.on('disconnect',function(){
		playerExit(client);
	});

});

// Main loop.
function gameLoop(gameID) {
	var game = games[gameID];
	if (game.status == STATUS.PLAYING) {
		var curTS = new Date().getTime();
		game.delta = (curTS - game.deltaLastTS) / 1000;
		game.deltaLastTS = curTS;
		var x, y, w, h, dir, isStopped, player, speed, assist, collision, dt;
		dt = game.delta;

		for (var i in game.players) {
			var player = game.players[i];
			isStopped = player.isStopped;
			// If player is alive.
			if (!player.isDead) {
				if (player.armor > 0) {
					player.armor -= game.delta;
				} else {
					player.armor = 0;
				}
				// if player is moving
				if (!isStopped) {
					x = player.x;
					y = player.y;
					w = player.w;
					h = player.h;
					dir = player.dir;
					speed = player.speed * dt;
					assist = false;

					if (player.sendRate > 0) {
						player.sendRate -= dt;
					} else {
						player.sendRate = 0.500;
						socket.in(gameID).emit('correct', { x: x, y: y, dir: dir });
					}

					// If player has changed direction, adjust xy, checking for collisions.
					if (player.changingDir) {
						var newW = (dir == "u" || dir == "d" ? 29 : 20);
						var newH = 23;
						//console.log(player);
						var testNewX = player["c"].x - Math.floor(newW/2);
						if (dir == "u" || dir == "d") {
							// Get new x using old centre
							//console.log("273");
							var boundaries = calculatePlayerBoundaries(testNewX, y, newW, newH, speed);
							var collisionLeft = (isCollision(player,boundaries.ltp) || isCollision(player,boundaries.lbp));
							var collisionRight = (isCollision(player,boundaries.rtp) || isCollision(player,boundaries.rbp));
							if (collisionLeft || collisionRight) { x = (Math.floor(((x - 20) / 30)) * 30) + 20 + 1; }
							else { x = testNewX; }
						} else {
							x = testNewX;
						}
						player.changingDir = false;
						updatePlayerCoor(player, x, y, dir, 0, speed);
						socket.in(gameID).emit('changeDir', { d: { x: player.x, y: player.y, dir: player.dir, altDir: player.altDir }, c: player.color });
						player.broadcastedMoving = true;
					} else {
						collision = checkForCollisions(player);
						if (collision != false) {
							if (collision.both) {
								updatePlayerCoor(player, x, y, dir, 0, speed);
								player.isStopped = true;
								socket.in(gameID).emit('stopMoving', { d: { x: player.x, y: player.y, dir: player.dir }, c: player.color });
							} else {
								assist = checkForPlayerAssist(player.c, collision.middle, dir, collision.empty);
								if (assist != false) {
									switch (dir) {
										case "u":
											movePlayer(player, assist+1, y-speed, speed, dir);
											break;
										case "d":
											movePlayer(player, assist+1, y+speed, speed, dir);
											break;
										case "l":
											movePlayer(player, x-speed, assist+4, speed, dir);
											break;
										case "r":
											movePlayer(player, x+speed, assist+4, speed, dir);
											break;
									}
									//socket.in(gameID).emit('changeDir', { d: { x: player.x, y: player.y, dir: player.dir, altDir: player.altDir }, c: player.color });
									//player.broadcastedMoving = true;
								} else {
									updatePlayerCoor(player, x, y, dir, 0, speed);
									player.isStopped = true;
									socket.in(gameID).emit('stopMoving', { d: { x: player.x, y: player.y, dir: player.dir }, c: player.color });
								}
							}
						} else {
							// If no collisions, move player.
							movePlayer(player, x, y, speed, dir);
						}
					}

					//console.log(centre.r + " " + centre.c);
					var pickedUp = checkIfItemPickup(gameID, player);
					if (pickedUp !== false) {
						socket.in(gameID).emit('pickedUp', pickedUp);
					} else {
						var isPD = checkIfPlayerDead(gameID, player);
						if (isPD !== false) {
							socket.in(gameID).emit('playerDied', isPD);
						}
					}
				} else {
					// if player has stopped moving
					var centre = player.c;
					var isPD = checkIfPlayerDead(gameID, player);
					if (isPD !== false) {
						socket.in(gameID).emit('playerDied', isPD);
					}
				}
			}
		}
		updateActiveBombs(game.delta, gameID);
		updateActiveExplosions(game.delta, gameID);
		game.gameLoopTimer = setTimeout(function() { gameLoop(gameID); }, tickrate);
	}
}

function updatePlayerCoor(player, x, y, dir, altDir, speed) {
	player.x = x;
	player.y = y;
	player.dir = dir;
	player.altDir = altDir;
	player.w = (dir == "u" || dir == "d" ? 29 : 20);
	player.h = 23;
	//console.log("355");
	var boundaries = calculatePlayerBoundaries(x, y, player.w, player.h, speed);
	for (bound in boundaries) {
		player[bound] = boundaries[bound];
	}
	return true;
}

// Check for potential collisions for specified player.
function checkForCollisions(player) {
	var x, y, w, h, dir, speed, pair1, pair2, point, boundaries;
	x = player.x;
	y = player.y;
	w = player.w;
	h = player.h;
	dir = player.dir;
	speed = player.speed * games[player.gameID].delta;
	//console.log("372");
	boundaries = calculatePlayerBoundaries(x, y, w, h, speed);
	switch (dir) {
		case "u":
			pair1 = boundaries.tlp;
			pair2 = boundaries.trp;
			point = "x";
			break;
		case "d":
			pair1 = boundaries.blp;
			pair2 = boundaries.brp;
			point = "x";
			break;
		case "l":
			pair1 = boundaries.ltp;
			pair2 = boundaries.lbp;
			point = "y";
			break;
		case "r":
			pair1 = boundaries.rtp;
			pair2 = boundaries.rbp;
			point = "y";
			break;
	}
	var collisionPair1 = isCollision(player,pair1);
	var collisionPair2 = isCollision(player,pair2);
	if (collisionPair1 || collisionPair2) {
		var collision = { };
		if (collisionPair1 == collisionPair2 || player.isDead) {
			collision.both = true;
		} else {
			collision.both = false;
			collision.middle = Math.max(pair1[point],pair2[point]);
			collision.empty = (collisionPair1 ? pair2[point] : pair1[point]);
		}
		return collision;
	} else {
		return false;
	}
}

// When player is near blocks and isn't necessarily inline with empty space, assist position.
// For example, if a certain percentage of the players' sprite is occupying more near the empty space: assist.
function checkForPlayerAssist(center, middlePoint, dir, successPoint) {
	var middle, successCol, p;
	switch (dir) {
		case "u":
		case "d":
			middle = (Math.floor((middlePoint - 20) / 30) * 30) + 20;
			successCol = (Math.floor((successPoint - 20) / 30) * 30) + 20;
			p = "x";
			break;
		case "l":
		case "r":
			middle = (Math.floor((middlePoint - 20) / 30) * 30) + 20;
			successCol = (Math.floor((successPoint - 20) / 30) * 30) + 20;
			p = "y";
			break;
	}
	
	var diff = middle - center[p];
	if (Math.abs(diff) > 4) {
		// if diff is positive, means it was a left side trigger, check if empty space is to the left.
		if (diff > 4 && successCol < middle) {
			// Left or Top Side triggered.
			//console.log("left top");
			return successCol;
		}
		// if diff is negative, means it was a right side trigger, check if empty space is to the right.
		else if (diff < (-1 * 4) && successCol == middle) {
			// Right or Bottom side triggered.
			//console.log("right bottom");
			return successCol;
		}
		else {
			return false;
		}
	} else {
		return false;
	}
	//console.log(col + " " + center.x);
}

// Uses a pair of x,y coordinates to determine if player will collide.
function isCollision(player, pair) {
	var row = Math.floor((pair.y - 20) / 30) + 1;
	var col = Math.floor((pair.x - 20) / 30) + 1;
	var item = games[player.gameID].board[row][col].b;
	if (item == "a") {
		var lastBomb = player.lastLay;
		var centerRow = Math.floor((player.c.y - 20) / 30) + 1;
		var centerCol = Math.floor((player.c.x - 20) / 30) + 1;	
		if (lastBomb.r == centerRow && lastBomb.c == centerCol) {
			return false;
		} else if (lastBomb.r == row && lastBomb.c == col) {
			return false;
		}
	} else if (item == "f" || item == "g" || item == "h") {
		return false;
	} else if (item.match(/m|p|s|i|a/) != null) {
		return false;
	} else if (Object.keys(player.lastLay).length > 0) {
		// if we are here, it's because we dont have bomb in player's space but a bomb has been laid
		// by current player somewhere around this empty space. Check all player boundaries, and if 
		// completely out of bomb to prevent player being locked in his own bomb.
		//console.log("477");
		var bounds = calculatePlayerBoundaries(player.x,player.y,player.w,player.h,player.speed * games[player.gameID].delta);
		var outOfOwnBombBounds = true;
		var lastBomb = player.lastLay;
		for (var b in bounds) {
			var centerRow = Math.floor((bounds[b].y - 20) / 30) + 1;
			var centerCol = Math.floor((bounds[b].x - 20) / 30) + 1;	
			if (lastBomb.r == centerRow && lastBomb.c == centerCol) {
				// still in same space containing player's own bomb, break out.
				outOfOwnBombBounds = false;
				break;
			}
		}
		if (outOfOwnBombBounds) {
			player.lastLay = {};
			//console.log("completely out of own bomb bounds");
		}
	}
	return (item != "e");
}

// Move player in provided direction and speed.
function movePlayer(player, x, y, speed, dir) {
	switch (dir) {
		case "u": y-=speed; break;
		case "d": y+=speed; break;
		case "l": x-=speed; break;
		case "r": x+=speed; break;
	}
	updatePlayerCoor(player, x, y, dir, player.altDir, speed);
	if (!player.broadcastedMoving) {
		player.broadcastedMoving = true;
		try {
			socket.to(player.gameID).send("playersocketID: " + player.socketID);
			socket.to(player.gameID).send("gameID: " + player.gameID);
			socket.to(player.socketID).broadcast.to(player.gameID).emit('changeDir', { d: { x: player.x, y: player.y, dir: player.dir, altDir: player.altDir }, c: player.color });
		} catch (e) {
			socket.to(player.gameID).send(e.stack);
		}
		//client.broadcast.to(client.gameID).emit('chatmsg', { c: client.gameColor, msg: data.substr(0,300) });
		//client.to(socketID).emit('layBomb', { r: data.r, c: data.c, o: p.color, s: sync, expStr: p.expStr, i: items });
	}
}

// Calculate player boundaries, pairs of points around sprite.
function calculatePlayerBoundaries(x, y, w, h, speed) {
	//console.log(y,speed);
	var boundaries = {
		// Center
		c: { x: Math.floor((w / 2) + x), y: Math.floor((h / 2) + y) },
		
		// Top left pair
		tlp: { x: x, y: Math.floor(y-1-speed) },
		
		// Top right pair
		trp: { x: x+w-1 , y: Math.floor(y-1-speed) },
		
		// Right top pair
		rtp: { x: x+w-1+Math.ceil(speed), y: y },
		
		// Right bottom pair
		rbp: { x: x+w-1+Math.ceil(speed), y: y+h-1 },
		
		// Bottom right pair
		brp: { x: x+w-1, y: y+h-1+Math.ceil(speed) },
		
		// Bottom left pair
		blp: { x: x, y: y+h-1+Math.ceil(speed) },
		
		// Left bottom pair
		lbp: { x: Math.floor(x-1-speed), y: y+h-1 },
		
		// Left top pair
		ltp: { x: Math.floor(x-1-speed), y: y }
	}
	return boundaries;
}



















// Check if player died by entering fire or is in an active explosion.
function checkIfPlayerDead(gameID, player) {
	// If player armor is 0, he is no longer invincible to fire.
	if (player.armor == 0) {
		var row = Math.floor((player["c"].y - 20) / 30) + 1;
		var col = Math.floor((player["c"].x - 20) / 30) + 1;	
		var item = games[gameID].board[row][col].b;
		// check if he is in any type of fire.
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
	} else {
		return false;
	}
}

// When player leaves, clean up gracefully.
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
		// Update people in lobby
		socket.in('bmlobby').emit('lobbyUpd_roomInfo', getRoomInfo(gameID));
		// If player leaves and room is empty, destroy room only if it's a player created one.
		if (game.players.length == 0 && !game.serverCreated) {
			clearTimeout(games[gameID].pingTimer);
			clearTimeout(games[gameID].gameLoopTimer);
			socket.in('bmlobby').emit('lobbyUpd_roomClosed', gameID);
			delete games[gameID];
		}
	}
	return true;
}

// Does game exist.
function gameExists(gameID) {
	return (typeof games[gameID] !== "undefined");
}

// Is Game Room title name taken.
function isRoomTitleTaken(name) {
	for (var gameID in games) {
		if (games[gameID].roomName == name) {
			return true;
		}
	}
	return false;
}



// ********** EXPLOSIONS AND BOMBS

// Retrieve items behind bricks depending on destruction caused by given bomb.
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

// Search given game for hidden items behind bricks that will show up when blown up.
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

// Triggered when explosions are done, either show items behind bricks or set all to empty.
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

// Update given game's active bombs time left param.
function updateActiveBombs(delta, gameID) {
	var ab = games[gameID].activeBombs;
	for (var bomb in ab) {
		ab[bomb].ts -= delta;
		if (ab[bomb].ts <= 0) {
			explode(ab[bomb]);
		}
	}
}

// Update given game's active explosions time left param.
function updateActiveExplosions(delta, gameID) {
	var ae = games[gameID].activeExplosions;
	for (var ex in ae) {
		ae[ex].ts -= delta;
		if (ae[ex].ts <= 0) {
			checkExplosions(gameID, ae[ex].origRow, ae[ex].origCol);
		}
	}
}

// When a bomb in the active bombs queue blows up.
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

// Triggered when bomb blows up, verifies explosion direction and resulting fire placement.
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

// Add a new explosion to the queue.
function addNewExplosion(gameID, row, col, origRow, origCol, typeOfFire, owner) {
	games[gameID].board[row][col].b = typeOfFire;
	//console.log("ane", row, col, games[gameID].board[row][col].b);
	games[gameID].activeExplosions.push({ row: row, col: col, origRow: origRow, origCol: origCol, o: owner, ts: 2 });
	//console.log("row: " + row + ", col: " + col + ", origRow: " + origRow + ", origCol: " + origCol + ", o: " + owner.color);
}



// ********** END OF EXPLOSIONS/BOMBS





// Retrieve board using gameID.
function getBoard(gameID) {
	//return games[gameID].board.map(function(i) { return i.join(""); });
	return games[gameID].board.map(function(e) { return e.map(function(b) { return b.b }).join(""); })
}

// Generate a new board for specified game.
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

// Check if player has just stepped over a pickable item.
function checkIfItemPickup(gameID, player) {
	var board = games[gameID].board;
	var row = Math.floor((player["c"].y - 20) / 30) + 1;
	var col = Math.floor((player["c"].x - 20) / 30) + 1;	
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

// Randomly choose whether a brick, when blown up, will show a certain item or empty.
function createBrickObj() {
	var bomb = { b: "b" };
	var rand = Math.floor(Math.random() * 10);
	var prob = ["e", "e", "i", "e", "e", "p", "m", "s", "e", "e" ];
	if (prob[rand] != "e") {
		bomb.i = prob[rand];
	}
	return bomb;
}

// Prevent players from escaping board border limits.
function isOutOfBoard(gameID, x, y, dir, speed) {
	var check;
	var game = games[gameID];
	var outOfBoard = false;
	var row = Math.floor((y - 20) / 30) + 1;
	var col = Math.floor((x - 20) / 30) + 1;
	var item;
	// width of d and u = 29, h = 23 for all
	// width of l and r = 20
	switch (dir) {
		case "u":
			check = y - speed;
			row = Math.floor((check - 20) / 30) + 1;
			break;
		case "d":
			check = y + 23 + speed;
			row = Math.floor((check - 20) / 30) + 1;
			break;
		case "r":
			check = x + 20 + speed;
			col = Math.floor((check - 20) / 30) + 1;
			break;
		case "l":
			check = x - speed;
			col = Math.floor((check - 20) / 30) + 1;
			break;
	}
	item = game.board[row][col].b;
	if (item == "o" || item == "w" || item == "b") {
		outOfBoard = true;
	}
	//console.log("pos: " + pos);
	return outOfBoard;
}

// Is color available for specified game.
function colorAvailable(gameID, color) {
	return games[gameID].availableColors[color];
}

// Is player name valid.
function isValidName(name) {
	return name.match(/^[A-Za-z]{1}[A-Za-z0-9_\-~+=!@#$%^&*\(\)\[\]]{1,14}$/);
}

// Is Game Room name valid.
function isValidGameRoomName(name) {
	return name.match(/^[A-Za-z]{1}[A-Za-z0-9\\/_\-! @#$'"%^\.&~=*\[\]\(\)+]{5,49}$/);
	//'
}

// Attempt joining player to specified game
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
		gameID: gameID,
		color: color,
		name: name,
		x: 0,
		y: 0,
		w: 29,
		h: 23,
		broadcastedMoving: false,
		ping: 0,
		dir: "d",
		altDir: 0,
		speed: 30,
		changingDir: false,
		isDis: false,
		noba: 1,
		sendRate: 0.500,
		nobp: 0,
		armor: 10,
		lastLay: {},
		isStopped: true,
		isDead: false,
		expStr: 1,
		score: 0
	});
	game.availableColors[color] = false;
	socketObj.gameID = gameID;
	socketObj.gameName = name;
	socketObj.gameColor = color;
	socketObj.gamePlaying = true;
	socketObj.join(gameID);
	return true;
}

// Ping Pong function used to calculate latency.
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

// Retreive player object using color in specified game.
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

// Reset all player values to default, spawn at specified spawn index position.
function resetPlayer(player, spawnPos) {
	var nxny = spawns[spawnPos];
	player.isDead = false;
	//player.x = nxny.x;
	//player.y = nxny.y;
	//player.dir = "d";
	player.speed = 30;
	player.noba = 1;
	player.armor = 10;
	player.isStopped = true;
	player.broadcastedMoving = false;
	//player.altDir = 0;
	player.nobp = 0;
	player.expStr = 1;
	player.lastLay = {};
	player.score = 0;
	var speed = player.speed * games[player.gameID].delta;
	updatePlayerCoor(player, nxny.x, nxny.y, "d", 0, speed);
}

// When player requests a spawn.
function spawnPlayer(gameID, color) {
	var spawn = { spawn: [] };
	var rand = Math.floor(Math.random() * 8);
	var p = getPlayer(gameID, color);
	if (p != false) {
		resetPlayer(p, rand);
		spawn.spawn.push({ c: p.color, pos: rand });
	}
	socket.in(gameID).emit("spawn", spawn);
}

// Triggered when all bricks are blown up.
function newGame(gameID) {
	var game = games[gameID];
	var spawn = { spawn: [] };
	for (var player in game.players) {
		var p = game.players[player];
		resetPlayer(p, player);
		spawn.spawn.push({ c: p.color, pos: player });
	}
	game.activeExplosions = [];
	game.activeBombs = [];
	game.bricksLeft = 198;
	game.board = makeBoard(gameID);
	game.status = STATUS.PLAYING;
	game.gameLoopTimer = setTimeout(function() { gameLoop(gameID); }, tickrate);
	socket.in(gameID).emit("newGame", getBoard(gameID));
	socket.in(gameID).emit("spawn", spawn);
}

// Retrieve player list from game.
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
			isStopped: (player.isStopped == true ? 1 : 0),
			isDead: player.isDead,
			expStr: player.expStr,
			score: player.score
		});
	}
	return players;
}

// Get room list.
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

// Get active bombs in given game.
function getActiveBombs(gameID) {
	var ab = [];
	for (var bomb in games[gameID].activeBombs) {
		var b = games[gameID].activeBombs[bomb];
		ab.push({ row: b.row, col: b.col, owner: b.o.color, ts: b.ts, expStr: b.expStr, items: getItemsBehindBricks(b) });
	}
	return ab;
}

// Get active explosions in given game.
function getActiveExplosions(gameID) {
	var ae = [];
	for (var exp in games[gameID].activeExplosions) {
		var e = games[gameID].activeExplosions[exp];
		ae.push({ row: e.row, col: e.col, owner: e.o.color, ts: e.ts });
	}
	return ae;
}

// Get room information from given game.
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

// Triggered when creating a new room.
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

// Create a unique game ID.
function createGameID() {
	var p = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz", gameID = "";
	for (var n = 0; n < 6; n++) { gameID += p[Math.floor(Math.random() * p.length)]; }
	return gameID;
}