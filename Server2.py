"""UDP hole punching server."""
import random
from twisted.internet.protocol import DatagramProtocol
from twisted.internet import reactor
from time import sleep

import sys

autostart = False
test = False
ROOM_CODE_LENGTH = 5
consonants = ["B", "C", "D", "F", "G", "H", "J", "K", "L",
              "M", "N", "P", "Q", "R", "S", "T", "V", "W", "X", "Y", "Z"]

# https://en.wikipedia.org/wiki/C0_and_C1_control_codes#C0_controls
# Control code designed for use as a delimiter.
DELIMITER = chr(31)

close_message_header = 'close' + DELIMITER
ok_message_header = 'ok' + DELIMITER
lobby_message_header = 'lobby' + DELIMITER
peers_message_header = 'peers' + DELIMITER

def address_to_string(address):
    ip, port = address
    return DELIMITER.join([ip, str(port)])


# used to catch errors and invalid registering, and relay to client
class ServerFail(Exception):
    def __init__(self, value):
        self.value = value

    def __str__(self):
        return(repr(self.value))


class ServerProtocol(DatagramProtocol):
    def __init__(self):
        self.active_sessions = {}
        self.registered_clients = {}

    def name_is_registered(self, name):
        return name in self.registered_clients

    def generate_room_code(self, n):
        if test:
            return "CHNDS"
        return ''.join(random.choices(consonants, weights=None, cum_weights=None, k=n))

    def create_session(self, client_list, host_ip):
        while True:
            s_id = self.generate_room_code(ROOM_CODE_LENGTH)
            if not s_id in self.active_sessions:
                break

        self.active_sessions[s_id] = Session(s_id, client_list, self, host_ip)
        return s_id

    def remove_session(self, s_id):
        try:
            # incase players are still in lobby
            for client in self.active_sessions[s_id].registered_clients:
                message = bytes(close_message_header+"Session closed.", "utf-8")
                self.transport.write(message, (client.ip, client.port))
                del self.registered_clients[client.name]
            del self.active_sessions[s_id]
        except KeyError:
            print("Tried to terminate non-existing session")

    def register_client(self, c_name, c_session, c_ip, c_port, c_nickname):
        if self.name_is_registered(c_name):
            # disconnect old client if they have the same ip
            if self.registered_clients[c_name].ip == c_ip:
                self.client_checkout(c_name)
            else:
                print("Client %s is already registered." % [c_name])
                raise(ServerFail("Client already registered"))
        if not c_session in self.active_sessions:
            print("Client registered for non-existing session")
            raise(ServerFail("Client registered for non-existing session"))
        elif len(self.active_sessions[c_session].registered_clients) >= int(self.active_sessions[c_session].client_max):
            print("Session full")
            raise(ServerFail("Session full"))
        else:
            new_client = Client(c_name, c_session, c_ip, c_port, c_nickname)
            self.registered_clients[c_name] = new_client
            self.active_sessions[c_session].client_registered(new_client)

    def exchange_info(self, c_session):
        if not c_session in self.active_sessions:
            return
        self.active_sessions[c_session].exchange_peer_info()

    def client_checkout(self, name):
        try:
            c = self.registered_clients[name]
            for s in self.active_sessions:
                if c in self.active_sessions[s].registered_clients:
                    self.active_sessions[s].registered_clients.remove(c)
                    self.active_sessions[s].update_lobby()
            # deleting c would not delete the index
            del self.registered_clients[name]
        except Exception as e:
            print("Error unregistering client", e)

    def datagramReceived(self, datagram, address):
        # Handle incoming datagram messages.

        print(datagram)
        data_string = datagram.decode("utf-8")
        msg_type = data_string[:2]

        if msg_type == "rs":
            # register session
            c_ip, c_port = address
            split = data_string.split(DELIMITER)
            max_clients = split[1]
            try:
                room_code = self.create_session(max_clients, c_ip)
                self.transport.write(
                    bytes(ok_message_header+str(c_port)+DELIMITER+str(room_code), "utf-8"), address)
            except ServerFail as e:
                self.transport.write(bytes(close_message_header+str(e), "utf-8"), address)

        elif msg_type == "rc":
            # register client
            split = data_string.split(DELIMITER)
            c_name = split[1]
            c_session = split[2]
            c_nickname = split[3]
            c_ip, c_port = address
            try:
                self.register_client(
                    c_name, c_session, c_ip, c_port, c_nickname)
                self.transport.write(
                    bytes(ok_message_header+str(c_port)+DELIMITER+str(c_session), "utf-8"), address)
            except ServerFail as e:
                self.transport.write(bytes(close_message_header+str(e), "utf-8"), address)
            else:
                self.active_sessions[c_session].update_lobby()

        elif msg_type == "ep":
            # exchange peers
            split = data_string.split(DELIMITER)
            room_code = split[1]
            self.exchange_info(room_code)

        elif msg_type == "cc":
            # checkout client
            split = data_string.split(DELIMITER)
            c_name = split[1]
            self.client_checkout(c_name)

        elif msg_type == "cs":
            # close session
            split = data_string.split(DELIMITER)
            room_code = split[1]
            c_reason = split[2]
            c_ip, c_port = address
            s = None
            try:
                s = self.active_sessions[room_code]
            except KeyError:
                print("Host tried to close non-existing session")
            else:
                if len(s.registered_clients) == 0 or s.host_ip != c_ip:
                    return  # just a teensy bit of security, non hosts can't close session
                s.close(c_reason)


class Session:
    def __init__(self, session_id, max_clients, server, host_ip):
        self.id = session_id
        self.client_max = max_clients
        self.server = server
        self.host_ip = host_ip
        self.registered_clients = []
        # timeout session after 10 minutes, just in case
        reactor.callLater(600, server.remove_session, session_id)

    def update_lobby(self):
        nicknames = []
        for client in self.registered_clients:
            nicknames.append(client.nickname)
        for client in self.registered_clients:
            message = bytes(lobby_message_header+(",".join(nicknames)) +
                            DELIMITER+self.client_max, "utf-8")
            self.server.transport.write(message, (client.ip, client.port))

    def client_registered(self, client):
        if client in self.registered_clients:
            return
        # print("Client %c registered for Session %s" % client.name, self.id)
        self.registered_clients.append(client)
        if autostart and len(self.registered_clients) == int(self.client_max):
            sleep(5)
            print("waited for OK message to send, sending out info to peers")
            self.exchange_peer_info()
        self.update_lobby()

    def exchange_peer_info(self):
        for addressed_client in self.registered_clients:
            address_list = []
            for client in self.registered_clients:
                if not client.name == addressed_client.name:
                    address_list.append(client.name + DELIMITER + address_to_string(
                        (client.ip, client.port))+DELIMITER+str(self.host_ip == client.ip))
            address_string = ",".join(address_list)
            message = bytes(peers_message_header + address_string, "utf-8")
            self.server.transport.write(
                message, (addressed_client.ip, addressed_client.port))

        print("Peer info has been sent. Terminating Session")
        for client in self.registered_clients:
            self.server.client_checkout(client.name)
        self.server.remove_session(self.id)

    def close(self, reason):
        for client in self.registered_clients:
            message = bytes(close_message_header + reason, "utf-8")
            self.server.transport.write(message, (client.ip, client.port))
            del self.server.registered_clients[client.name]
        print("Closing session due to: "+reason)
        self.server.remove_session(self.id)


class Client:

    def confirmation_received(self):
        self.received_peer_info = True

    def __init__(self, c_name, c_session, c_ip, c_port, c_nickname):
        self.name = c_name
        self.session_id = c_session
        self.ip = c_ip
        self.port = c_port
        self.nickname = c_nickname
        self.received_peer_info = False


if __name__ == '__main__':
    if len(sys.argv) <= 3:
        print("Usage: python3 server.py PORT AUTOSTART(y/n) TEST(y/n)")
        sys.exit(1)
    port = int(sys.argv[1])
    autostart = sys.argv[2] == "y"
    test = sys.argv[3] == "y"
    reactor.listenUDP(port, ServerProtocol())
    print('Listening on *:%d' % (port))
    reactor.run()
