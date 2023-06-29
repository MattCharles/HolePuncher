import { randomInt } from "crypto";

const net = require("net");

const DELIMITER: string = String.fromCharCode(31);
const ROOM_CODE_LENGTH: number = 5;
const MAX_ROOM_SIZE: number = 4;
const CONSONANTS: string[] = [
  "B",
  "C",
  "D",
  "F",
  "G",
  "H",
  "J",
  "K",
  "L",
  "M",
  "N",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "V",
  "W",
  "X",
  "Z",
];

type Player = {
  nickname: string;
  id: number;
};

type Lobby = {
  room_code: string;
  max_players: number;
  players: Player[];
  public: boolean;
  port: number;
};

let private_servers: Map<string, Lobby> = new Map<string, Lobby>();
let public_servers: Map<string, Lobby> = new Map<string, Lobby>();

let server = net
  .createServer((socket: any) => {
    socket.on("data", (data: Buffer) => {
      let message: string = data.toString("utf-8");
      let args: string[] = message.split(DELIMITER);
      let type: string = trim_controls(args[0]);
      if (type.includes("join")) {
        if (args.length > 1) {
          let room_code: string = args[2];
          let room: Lobby | undefined = get_room(room_code);
          if (room === undefined) {
            socket.write("Room " + room_code + " not found.\n");
            return;
          } else {
            console.log("Found room!");
            let player: Player = {
              nickname: "",
              id: 0,
            };
            // Idk do some stuff
          }
        }
      }
      if (type.includes("create")) {
        if (args.length > 1) {
          let nickname: string = args[1];
          let max_players: string = args[2];
          let is_public: string = args[3];
          let player_id: string = args[4];
          let num_max_players: number = parseInt(max_players);
          let public_number: number = parseInt(is_public);
          let id_number: number = parseInt(player_id);
          console.log("initializing");
          if (isNaN(num_max_players)) {
            socket.write("Invalid lobby size - not a number.");
            return;
          } else if (num_max_players > MAX_ROOM_SIZE) {
            socket.write(
              `Requested lobby size is greater than maximum allowed. Maximum lobby size is ${MAX_ROOM_SIZE}`
            );
            return;
          }
          if (
            isNaN(public_number) ||
            (public_number != 0 && public_number != 1)
          ) {
            console.log("bad public number");
            socket.write("Invalid public setting - please use 0 or 1.");
            return;
          }
          if (isNaN(id_number)) {
            console.log("bad player id");
            socket.write("Invalid player id provided - please use an integer.");
            return;
          }
          console.log("make player");
          let player: Player = {
            nickname: nickname,
            id: id_number,
          };
          console.log("make room");
          let room: Lobby = create_room(
            player,
            num_max_players,
            public_number == 1
          );
          console.log("Good!");
          // Success! Return room code and port
          socket.write(["rc", room.room_code, room.port].join(DELIMITER));
        }
      }
    });
    console.log("Accepted connection.");
    socket.write("Hello from the server!\n");
  })
  .listen(12939, () => console.log("Listening on 12939."));

function get_room(room_code: string): Lobby | undefined {
  if (room_code.length != ROOM_CODE_LENGTH) {
    return undefined;
  } else {
    return private_servers.get(room_code) ?? public_servers.get(room_code);
  }
}

function join_lobby(room_code: string, player: Player) {
  console.log("join lobby");
}

function create_room(
  creator: Player,
  max_players: number,
  is_public: boolean
): Lobby {
  let room_code: string = generate_unique_room_code(ROOM_CODE_LENGTH);
  let port: number = choose_free_port();
  let lobby: Lobby = {
    room_code: room_code,
    max_players: max_players,
    players: [creator],
    public: is_public,
    port: port,
  };
  let server_list = is_public ? public_servers : private_servers;
  server_list.set(room_code, lobby);
  return lobby;
}

function choose_free_port(): number {
  return 12940;
}

function generate_room_code(size: number): string {
  if (size == 0) {
    return "";
  }
  let random_index: number = randomInt(CONSONANTS.length);
  let result: string = generate_room_code(size - 1) + CONSONANTS[random_index];
  return result;
}

function generate_unique_room_code(size: number): string {
  let result: string = "";
  do {
    result = generate_room_code(size);
    console.log(result);
  } while (room_code_is_taken(result));
  return result;
}

function room_code_is_taken(room_code: string): boolean {
  return (
    room_code.length == ROOM_CODE_LENGTH &&
    (private_servers.has(room_code) || public_servers.has(room_code))
  );
}

function trim_controls(input: string): string {
  let result: string = "";
  for (let i: number = 0; i < input.length; i++) {
    if (input.charCodeAt(i) > 32) {
      console.log("* " + input.charAt(i));
      result = result.concat(input.charAt(i));
    }
  }
  return result;
}
