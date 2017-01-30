var Game = require('./game');
var Player = require('./player');
require("console-stamp")(console, "m/dd HH:MM:ss");
var mongoose = require('mongoose');
var User = mongoose.model('User');
var crypto = require('crypto');

var avatars = require(__dirname + '/../../app/controllers/avatars.js').all();
// Valid characters to use to generate random private game IDs
var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";

// Generates a randomId
function randomId() {
    return crypto.createHash('md5').update(Math.random().toString()).digest('hex').substring(0, 24);
}

module.exports = function(io) {

  var game;
  var allGames = {};
  var allPlayers = {};
  var gamesNeedingPlayers = [];
  var gameID = 0;

  io.sockets.on('connection', function (socket) {
    console.log(socket.id +  ' Connected');
    socket.emit('id', {id: socket.id});

    socket.on('pickCards', function(data) {
      console.log(socket.id,"picked",data);
      if (allGames[socket.gameID]) {
        allGames[socket.gameID].pickCards(data.cards,socket.id);
      } else {
        console.log('Received pickCard from',socket.id, 'but game does not appear to exist!');
      }
    });

    socket.on('pickWinning', function(data) {
      if (allGames[socket.gameID]) {
        allGames[socket.gameID].pickWinning(data.card,socket.id);
      } else {
        console.log('Received pickWinning from',socket.id, 'but game does not appear to exist!');
      }
    });

    socket.on('joinGame', function(data) {
      if (!allPlayers[socket.id]) {
        joinGame(socket,data);
      }
    });

    socket.on('joinNewGame', function(data) {
      exitGame(socket);
      joinGame(socket,data);
    });

    socket.on('startGame', function() {
      if (allGames[socket.gameID]) {
        var thisGame = allGames[socket.gameID];
        console.log('comparing',thisGame.players[0].socket.id,'with',socket.id);
        if (thisGame.players.length >= thisGame.playerMinLimit) {
          // Remove this game from gamesNeedingPlayers so new players can't join it.
          gamesNeedingPlayers.forEach(function(game,index) {
            if (game.gameID === socket.gameID) {
              return gamesNeedingPlayers.splice(index,1);
            }
          });
          thisGame.prepareGame();
          thisGame.sendNotification('The game has begun!');
          saveGame(thisGame);
        }
      }
    });

    socket.on('leaveGame', function() {
      exitGame(socket);
    });

    socket.on('disconnect', function(){
      console.log('Rooms on Disconnect ', io.sockets.adapter.rooms);
      exitGame(socket);
    });
  });

  var joinGame = function(socket,data) {
    var player = new Player(socket);
    data = data || {};
    player.userID = data.userID || 'unauthenticated';
    if (data.userID !== 'unauthenticated') {
      User.findOne({
        _id: data.userID
      }).exec(function(err, user) {
        if (err) {
          console.log('err',err);
          return err; // Hopefully this never happens.
        }
        if (!user) {
          // If the user's ID isn't found (rare)
          player.username = 'Guest';
          player.avatar = avatars[Math.floor(Math.random()*4)+12];
        } else {
          player.username = user.name;
          player.premium = user.premium || 0;
          player.avatar = user.avatar || avatars[Math.floor(Math.random()*4)+12];
        }
        getGame(player,socket,data.room,data.createPrivate);
      });
    } else {
      // If the user isn't authenticated (guest)
      player.username = 'Guest';
      player.avatar = avatars[Math.floor(Math.random()*4)+12];
      getGame(player,socket,data.room,data.createPrivate);
    }
  };

  var getGame = function(player,socket,requestedGameId,createPrivate) {
    requestedGameId = requestedGameId || '';
    createPrivate = createPrivate || false;
    console.log(socket.id,'is requesting room',requestedGameId);
    if (requestedGameId.length && allGames[requestedGameId]) {
      console.log('Room',requestedGameId,'is valid');
      var game = allGames[requestedGameId];

      
      if (game.state === 'waiting for players to pick') {
        playerID = player.socket.id;
        // Alerts players trying to access an already full game
        if (game.players.length === game.playerMaxLimit) {
          game.Notification(playerID, 'Hey full house, get lost');
        } 
        // Alerts players trying to request an already started game 
        else {
          game.Notification(playerID, 'Game has already started');
        }
      }

      // Ensure that the same socket doesn't try to join the same game
      // This can happen because we rewrite the browser's URL to reflect
      // the new game ID, causing the view to reload.
      // Also checking the number of players, so node doesn't crash when
      // no one is in this custom room.
      if (game.state === 'awaiting players' && (!game.players.length ||
        game.players[0].socket.id !== socket.id)) {
        // Put player into the requested game
        console.log('Allowing player to join',requestedGameId);
        allPlayers[socket.id] = true;
        game.players.push(player);
        socket.join(game.gameID);
        socket.gameID = game.gameID;
        game.assignPlayerColors();
        game.assignGuestNames();
        game.sendUpdate();
        game.sendNotification(player.username+' has joined the game!');
        if (game.players.length >= game.playerMaxLimit) {
          gamesNeedingPlayers.shift();
          game.prepareGame();
        }
      } else {
        // TODO: Send an error message back to this user saying the game has already started
      }
    } else {
      // Put players into the general queue
      console.log('Redirecting player',socket.id,'to general queue');
      if (createPrivate) {
        createGameWithFriends(player,socket);
      } else {
        fireGame(player,socket);
      }
    }

  };

  var fireGame = function(player,socket) {
    var game;
    if (gamesNeedingPlayers.length <= 0) {
      // assigns gameID a random number
      gameID = randomId();
      var gameIDStr = gameID.toString();
      game = new Game(gameIDStr, io);
      allPlayers[socket.id] = true;
      game.players.push(player);
      allGames[gameID] = game;
      gamesNeedingPlayers.push(game);
      socket.join(game.gameID);
      socket.gameID = game.gameID;
      console.log(socket.id,'has joined newly created game',game.gameID);
      game.assignPlayerColors();
      game.assignGuestNames();
      game.sendUpdate();
    } else {
      game = gamesNeedingPlayers[0];
      allPlayers[socket.id] = true;
      game.players.push(player);
      console.log(socket.id,'has joined game',game.gameID);
      socket.join(game.gameID);
      socket.gameID = game.gameID;
      game.assignPlayerColors();
      game.assignGuestNames();
      game.sendUpdate();
      game.sendNotification(player.username+' has joined the game!');
      if (game.players.length >= game.playerMaxLimit) {
        gamesNeedingPlayers.shift();
        game.prepareGame();
      }
    }
  };

  // saveGame function to add game data to the database
   var saveGame = function(game) {
    function showPlayers(players){
      var results = []
      for (var player in players) {
        var result = {};
        if(players.hasOwnProperty(player)) {
          result['UserID'] = players[player].userID
          result['Username'] = players[player].username;
          result['Avatar'] = players[player].avatar
        }
        results.push(result);
      }
      return results;
    };

    if (allGames[game.gameID]) {
      Gamedb.findOne({
        gameId: game.gameID
      }).exec(function(err, existingGame) {
        if (!existingGame) {
          var newGame = new Gamedb({
            gameId: game.gameID,
            players: showPlayers(game.players),
            gameWinner: game.gameWinner
          })
          newGame.save(function(err, doc) {
          if (err) return console.log('error');
          console.log(doc);
        })
      } else {
          gameWinner = game.gameWinner;
          players = showPlayers(game.players);
      }
    });
    }
  }

  var createGameWithFriends = function(player,socket) {
    var isUniqueRoom = false;
    var uniqueRoom = '';
    // Generate a random 6-character game ID
    while (!isUniqueRoom) {
      uniqueRoom = '';
      for (var i = 0; i < 6; i++) {
        uniqueRoom += chars[Math.floor(Math.random()*chars.length)];
      }
      if (!allGames[uniqueRoom] && !(/^\d+$/).test(uniqueRoom)) {
        isUniqueRoom = true;
      }
    }
    console.log(socket.id,'has created unique game',uniqueRoom);
    var game = new Game(uniqueRoom,io);
    allPlayers[socket.id] = true;
    game.players.push(player);
    allGames[uniqueRoom] = game;
    socket.join(game.gameID);
    socket.gameID = game.gameID;
    game.assignPlayerColors();
    game.assignGuestNames();
    game.sendUpdate();
  };

  var exitGame = function(socket) {
    console.log(socket.id,'has disconnected');
    if (allGames[socket.gameID]) { // Make sure game exists
      var game = allGames[socket.gameID];
      console.log(socket.id,'has left game',game.gameID);
      delete allPlayers[socket.id];
      if (game.state === 'awaiting players' ||
        game.players.length-1 >= game.playerMinLimit) {
        game.removePlayer(socket.id);
      } else {
        // When game is over, it updates the gameWinner to the
        // actually winner of the game
        Gamedb.findOne({
          gameId: game.gameID
        }, function(err, g) {
          if (err) throw err;
          console.log(g);

          // assigns gameWinner variable the winner
          g.gameWinner = game.gameWinner;

          // saves the change made
          g.save(function(err) {
            if (err) throw err;
            console.log('successfully updated!');
          });

        });
        game.stateDissolveGame();
        for (var j = 0; j < game.players.length; j++) {
          game.players[j].socket.leave(socket.gameID);
        }
        game.killGame();
        delete allGames[socket.gameID];
      }
    }
    socket.leave(socket.gameID);
  };

};
