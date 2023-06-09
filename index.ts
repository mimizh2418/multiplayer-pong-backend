import express from 'express';
import http from 'http';
import { Server, type Socket } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 9387;

let players:{[key:string]:Player}={}
let rooms:{[key:string]:PongRoom}={}
let latestRoom:PongRoom;


function getPlayer(socket:Socket):Player {
    return players[socket.id]
}

class Player {
    private socket:Socket;
    private points:number = 0;
    private roomId?:string;
    opponent?:Player;
    private playerName:string;

    get name() {return this.playerName}

    
    constructor(socket:Socket, name:string) {
        this.socket = socket
        this.playerName = name;

        socket.on("setName", (name:string) => this.playerName = name)
        socket.on("leave", () => {console.log("leave recieved")})
    }

    get score() {return this.points}
    get id() {return this.socket.id}
    get room() {return this.roomId == null ? null : rooms[this.roomId]}
    
    emit(event:string, ...data:any[]) {
        this.socket.emit(event, ...data)
    }
    leaveRoom() {
        this.socket.removeAllListeners()
        this.opponent = undefined;
        this.roomId = undefined;
        this.points = 0
        this.socket.emit("cancelGame")
        this.socket.emit("opponentName", "not present")
        if (!this.socket.disconnected) {
            enqueue(this)
        }
    }

    joinRoom(room:PongRoom, opponent:Player) {
        this.roomId=room.id;
        this.opponent = opponent;
        this.socket.emit("inRoom")
        this.socket.emit("opponentName", opponent.name)
        addHandlers(this, this.socket)
    }

    get disconnected() {
        return this.socket.disconnected;
    }
    delete() {
        this.socket.disconnect()
        delete players[this.id]
        this.leaveRoom()
    }

    ping(cb:() => void) {
        this.socket.timeout(200).emit("ping", (err) => {if (err) {this.delete(); cb()}})
    }
    incrementScore() {this.points++;}

    toString() {
        return this.name+":"+this.id
    }

}
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

class PongRoom {
    readonly id:string = uuidv4();
    private players:Player[] = [];

    get isFull() {return this.players.length >=2}
    addPlayer(player:Player) {
        console.log(player.toString())
        if (this.isFull) {console.warn("adding to full room"); return}
        this.players.push(player)

        if (this.isFull) {
            this.setup()
        }
        
    }

    refresh() {
        this.players.forEach((player) => player.ping(() => {
            console.log("clearing")
            this.players.forEach((player) => player.leaveRoom())
        }))
    }
    

    setup() {
        this.players[0].joinRoom(this, this.players[1])
        this.players[1].joinRoom(this, this.players[0])
    }

    end() {
        this.players.forEach((player) => player.leaveRoom())
    }

    incrementOpponentScore(socket:Socket) {
        const player = getPlayer(socket);
        console.log("incrementing", player.toString())
        player.opponent!.incrementScore()
        player.opponent!.emit("scores", {self:player.opponent!.score, opponent:player.score})
        player.emit("scores", {self:player.score, opponent:player.opponent!.score})

        if (player.opponent!.score >= 7) {
            this.end();
        }
    }


}

io.on('connection', (socket) => {
    socket.on("login", (name) => {
        name = name.slice(0, 40);
        console.log("logging in ", socket.id, name)
        players[socket.id] = new Player(socket, name)
        console.log(Object.values(players).map((player) => player.toString()))
        enqueue(players[socket.id])
    })
});






function enqueue(player:Player) {
    console.log("Queuing")
    if (latestRoom == null || latestRoom.isFull) {
        console.log("full")
        latestRoom = new PongRoom()
        rooms[latestRoom.id]= latestRoom
    }
    latestRoom.refresh()
    latestRoom.addPlayer(player)   
}


function addHandlers(player:Player,socket:Socket) {
    socket.on("paddleHit", (ballPosition: {x: number, y: number}, ballVector: {magnitude: number, degrees: number}, paddlePosition: number) => {
        player.opponent!.emit("paddleHit", ballPosition, ballVector, paddlePosition);
    });
    socket.on("paddleSpeedChange", (speed: number, ypos: number) => {
        player.opponent!.emit("paddleSpeedChange", speed, ypos);
    });
    socket.on("startGame", (ballVector) => {
        player.opponent!.emit("startGame", ballVector);
    });
    socket.on("opponentScored", (ballVector: {magnitude: number, degrees: number}) => {
        console.log(socket.id+" sentOpponentScored")
        player.opponent!.emit("scored", ballVector)
        player.room!.incrementOpponentScore(socket)
    });

    socket.on("paddlePosition", (position:number) => {
        player.opponent!.emit("paddingPosition", position)
    })

    socket.on("disconnect", () => {
        player.room?.refresh()
    })
    
}

server.listen(port, () => {
    console.log("Listening on ", port);
});