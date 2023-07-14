import { spawn } from "child_process";
import { randomInt } from "crypto";

const net = require("net");

const OWN_PORT: number = 12939;
const DELIMITER: string = String.fromCharCode(31);
const ROOM_CODE_LENGTH: number = 5;
const MAX_ROOM_SIZE: number = 4;
const MAX_NAME_SIZE: number = 16;
const SERVER_EXEC_PATH: string = "/home/mattdacat/Builds/server.x86_64";
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
  ready: boolean;
  ordinal: number;
  last_update: number;
  ingame_id: string | undefined;
};

// TODO: only host can start?
// Anyone can start once all have readied up?
// Autostart on all ready up?

// TODO: track last_update for lobby - if all DC at same time, can prune lobby
type Lobby = {
  name: string;
  room_code: string;
  max_players: number;
  players: Player[];
  public: boolean;
  port: number;
  started: boolean;
};

let private_servers: Map<string, Lobby> = new Map<string, Lobby>();
let public_servers: Map<string, Lobby> = new Map<string, Lobby>();

let known_players: Map<number, Lobby> = new Map<number, Lobby>();
let ip_to_id: Map<string, number> = new Map<string, number>();

const MIN_GAME_PORT = 12940;
const MAX_GAME_PORT = 22940;
let busy_ports: Set<number> = new Set<number>();

let server = net
  .createServer((socket: any) => {
    socket.on("data", (data: Buffer) => {
      let message: string = data.toString("utf-8");
      console.log(`received message: \n${message}`);
      let ip_and_port = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(ip_and_port);
      let args: string[] = message
        .split(DELIMITER)
        .map((value) => trim_controls(value))
        .filter((value) => {
          value != null && value != undefined && value != ``;
        });
      let type: string = args[0];
      if (type.includes("join")) {
        if (args.length > 1) {
          let nickname: string = args[1];
          let room_code: string = args[2];
          let id: number = parseInt(args[3]);
          if (isNaN(id)) {
            socket.write("Invalid ID: not a number");
          }
          let room: Lobby | undefined = get_room(room_code);
          if (room === undefined) {
            socket.write("Room " + room_code + " not found.\n");
            return;
          } else {
            console.log("Found room!");
            if (room.players.length >= room.max_players) {
              socket.write("Room " + room_code + " full");
              return;
            }
            if (
              room.players.find((player: Player) => player.id == id) !=
              undefined
            ) {
              socket.write("Brother you are already in this room");
              return;
            }
            let existing_room: Lobby | undefined = known_players.get(id);
            if (existing_room != undefined) {
              console.log("Player is already in a room");
              remove_player(existing_room, id);
            }
            let player: Player = {
              nickname: nickname,
              id: id,
              ready: true,
              ordinal: room.players.length + 1,
              last_update: Date.now(),
              ingame_id: undefined,
            };
            room.players.push(player);
            socket.write("jr" + DELIMITER + room.port + DELIMITER + room.name);
          }
        }
      }
      if (type.includes("create")) {
        if (args.length == 6) {
          let nickname: string = args[1];
          let max_players: string = args[2];
          let is_public: boolean | undefined = parseBool(args[3]);
          if (is_public == undefined) {
            console.log("bad public number");
            socket.write("Invalid public setting - please use 0 or 1.");
            return;
          }
          let player_id: string = args[4];
          let room_name: string = args[5];
          if (room_name.length > MAX_NAME_SIZE) {
            console.log("room name too long!");
            socket.write(
              `Room name too long. Please use ${MAX_NAME_SIZE} or fewer characters.`
            );
            return;
          }
          let num_max_players: number = parseInt(max_players);
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
          if (isNaN(id_number)) {
            console.log("bad player id");
            socket.write("Invalid player id provided - please use an integer.");
            return;
          }
          ip_to_id.set(ip_and_port, id_number);
          console.log(`${ip_and_port} id set to ${id_number}`);
          console.log("make player");
          let existing_room: Lobby | undefined = known_players.get(id_number);
          if (existing_room != undefined) {
            console.log("Player is already in a room");
            remove_player(existing_room, id_number);
          }
          let player: Player = {
            nickname: nickname,
            id: id_number,
            ready: true,
            ordinal: 1,
            last_update: Date.now(),
            ingame_id: undefined,
          };
          console.log("make room");
          let try_port: number | undefined = choose_free_port();
          let port: number = -1;
          if (try_port == undefined) {
            socket.write("No free ports!");
            return;
          } else {
            port = try_port!;
          }
          if (port == -1) {
            socket.write("Server error - port allocation failed.");
            return;
          }
          let room: Lobby = create_room(
            room_name,
            player,
            num_max_players,
            is_public,
            port
          );
          console.log("room creation success - return room code");
          socket.write(["rc", room.room_code].join(DELIMITER));
        }
      }
      if (type.includes("start")) {
        console.log("Start game requested");
        let room_code: string = args[1];
        let room: Lobby | undefined = get_room(room_code);
        if (room === undefined) {
          socket.write("Room " + room_code + " not found.\n");
          return;
        } else {
          console.log("Found room!");
          let all_ready: boolean = room.players.reduce<boolean>(
            (prev_ready, player) => prev_ready && player.ready,
            true
          );
          if (!all_ready) {
            console.log("Not all ready");
            socket.write("Can't start yet! not all players are ready.");
            return;
          } else {
            console.log("everyone's ready!");
            if (!busy_ports.has(room.port)) {
              busy_ports.add(room.port);
            }
            spawn_game_server(room.port, room.max_players);
            room.started = true; // next time players check on room, they'll see that it's time to start
            socket.write([`gs`, room.port].join(DELIMITER));
          }
        }
      }
      if (type.includes("list")) {
        console.log("List lobbies requested");
        let message: string = `ll`;
        console.log(public_servers.keys());
        for (let key of public_servers.keys()) {
          console.log(`key is ${key}`);
          let maybe_room: Lobby | undefined = public_servers.get(key);
          if (maybe_room == undefined) {
            // some sort of weird internal server error
            console.log("couldn't find room " + key);
            continue;
          }
          let room: Lobby = maybe_room;
          let current_player_count: number = room.players.length;
          let max_player_count: number = room.max_players;
          let room_name: string = room.name;
          message +=
            DELIMITER +
            key + // room_code
            DELIMITER +
            room_name +
            DELIMITER +
            current_player_count +
            DELIMITER +
            max_player_count;
        }
        console.log(message);
        socket.write(message);
      }
      if (type.includes("detail")) {
      }
      if (type.includes("exit")) {
        let id_string: string = args[1];
        console.log(`exiting for ${id_string}`);
        let id: number | undefined = parseInt(id_string);
        if (isNaN(id) || id == undefined) {
          socket.write("Invalid ID provided.");
          return;
        }
        let lobby: Lobby | undefined = known_players.get(id);
        if (lobby === undefined) {
          socket.write(`Could not find lobby for ${id}`);
          return;
        } else {
          remove_player(lobby, id);
        }
      }
      if (type.includes("ready")) {
        let room_code: string = args[1];
        let id_string: string = args[2];
        let id: number | undefined = parseInt(id_string);
        if (isNaN(id) || id == undefined) {
          socket.write("Invalid ID provided.");
          return;
        }
        let id_number: number = id;
        ip_to_id.set(ip_and_port, id_number);
        let status: boolean | undefined = parseBool(args[3]);
        if (status == undefined) {
          socket.write("Invalid status received - please use 0 or 1.");
          return;
        }
        let room: Lobby | undefined = get_room(room_code);
        if (room === undefined) {
          socket.write("Room " + room_code + " not found.\n");
          return;
        } else {
          console.log("Found room!");
          let player: Player | undefined = room.players.find(
            (player) => player.id == id
          );
          if (player == undefined) {
            socket.write(
              `Player with ID ${id} not found in room ${room_code}.`
            );
            return;
          } else {
            // if all are ready and game is started, send start game message
            if (room.started == true) {
              // game could only be started if all players were ready: if you changed your mind too bad >:P
              console.log("Starting game!");
              socket.write([`gs`, room.port].join(DELIMITER));
              setTimeout(() => {
                if (room) {
                  room.started = false;
                }
              }, 1000); // after a minute, list this room as not started - this way we can return to lobby gracefully
              return;
            }
            player.ready = status;
            let message: string = construct_ready_message(room.players);
            socket.write(message);
          }
        }
      }
    });
    socket.on("error", (err: Error) => {
      if (
        socket.remoteAddress !== undefined &&
        socket.remotePort !== undefined
      ) {
        let ip_and_port = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`error from ${ip_and_port}`);
        if (ip_to_id.has(ip_and_port)) {
          let errored_user_id: number | undefined = ip_to_id.get(ip_and_port);
          console.log(`got id ${errored_user_id} from ${ip_and_port}`);
          if (errored_user_id === undefined) {
            console.error(`Can't find ${ip_and_port} in ip_to_id`);
          } else {
            ip_to_id.delete(ip_and_port);
            if (known_players.has(errored_user_id)) {
              let dropped_lobby: Lobby | undefined =
                known_players.get(errored_user_id);
              if (dropped_lobby === undefined) {
                console.error(
                  `Trying to drop player ${errored_user_id} from unfound lobby.`
                );
              } else {
                console.log(
                  `Removing ${errored_user_id} from ${dropped_lobby.room_code}`
                );
                remove_player(dropped_lobby, errored_user_id);
              }
            }
          }
        }
      }
      console.error(`${err.name}: ${err.message}`);
    });
    console.log("Accepted connection.");
    socket.write("Hello from the server!\n");
  })
  .listen(OWN_PORT, () => console.log(`Listening on ${OWN_PORT}.`));

function get_room(room_code: string): Lobby | undefined {
  if (room_code.length != ROOM_CODE_LENGTH) {
    return undefined;
  } else {
    return private_servers.get(room_code) ?? public_servers.get(room_code);
  }
}

function create_room(
  name: string,
  creator: Player,
  max_players: number,
  is_public: boolean,
  port_number: number
): Lobby {
  let room_code: string = generate_unique_room_code(ROOM_CODE_LENGTH);
  let lobby: Lobby = {
    name: name,
    room_code: room_code,
    max_players: max_players,
    players: [creator],
    public: is_public,
    port: port_number,
    started: false,
  };
  console.log(`Setting ${room_code} as key to access lobby.`);
  if (is_public) {
    public_servers.set(room_code, lobby);
    console.log(public_servers.keys());
  } else {
    private_servers.set(room_code, lobby);
    console.log(private_servers.keys());
  }
  known_players.set(creator.id, lobby);
  return lobby;
}

// Returns the port number that a game should use, or undefinied if no ports are available.
function choose_free_port(): number | undefined {
  for (let i = MIN_GAME_PORT; i < MAX_GAME_PORT; i++) {
    if (!busy_ports.has(i)) {
      busy_ports.add(i);
      return i;
    }
  }
  // TODO: spin up a new VM?
  return undefined;
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
      result = result.concat(input.charAt(i));
    }
  }
  return result;
}

function spawn_game_server(port: number, max_players: number) {
  console.log(`Starting server on port ${port}!`);
  var subprocess = spawn(
    `${SERVER_EXEC_PATH}`,
    [`--headless`, `--`, `port=${port}`, `max-players=${max_players}`],
    { stdio: `inherit` }
  );
  subprocess.on(`exit`, (code) => {
    if (code) {
      console.log("child process exited with code " + code.toString());
    }
    if (busy_ports.delete(port)) {
      console.log(`Port ${port} freed!`);
    } else {
      console.log(`Warning - port ${port} was already considered free`);
    }
  });
}

function parseBool(input: string): boolean | undefined {
  let input_number: number = parseInt(input);
  if (isNaN(input_number) || (input_number != 0 && input_number != 1)) {
    return undefined;
  }
  return input_number == 1;
}

function construct_ready_message(players: Player[]): string {
  let message: string = "rd" + DELIMITER;
  players.forEach((player: Player) => {
    message += [player.id, player.nickname, player.ordinal, player.ready].join(
      DELIMITER
    );
    message += DELIMITER;
  });
  return message.substring(0, message.length - 1);
}

function remove_player(lobby: Lobby, player_id: number): Lobby | undefined {
  lobby.players.forEach((player, index) => {
    if (player.id === player_id) lobby.players.splice(index, 1);
  });
  ensure_nonzero_player_count(lobby);
  return lobby;
}

function ensure_nonzero_player_count(lobby: Lobby) {
  let room_code: string = lobby.room_code;
  console.log(`Ensuring nonzero player count in ${room_code}`);
  let server: Lobby | undefined = lobby.public
    ? public_servers.get(room_code)
    : private_servers.get(room_code);
  console.log(
    `server defined? ${server != undefined} player length = ${
      server?.players.length
    }`
  );
  if (server != undefined && server.players.length == 0) {
    if (busy_ports.has(server.port)) {
      busy_ports.delete(server.port);
    }
    console.log(`bout to delete`);
    lobby.public
      ? public_servers.delete(room_code)
      : private_servers.delete(room_code);
  }
}
