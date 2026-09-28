/**
 * Networking: sockets, transfers, names, tunnels and firewalls.
 */

import { cmd, type CommandEntry } from '../commandModel'

export const networkCommands: CommandEntry[] = [
  cmd('curl', 'Network', 'Transfer data to or from a URL', 'curl [OPTION]... URL...', {
    description:
      'Speaks HTTP, FTP, and a dozen other protocols. By default it prints the body to standard output and says nothing about the request -- add -v when something is wrong and -sS inside scripts.',
    options: [
      { flag: '-X METHOD', summary: 'Set the HTTP method' },
      { flag: '-H "Header: value"', summary: 'Add a request header' },
      { flag: '-d DATA', summary: 'Send a body (implies POST)' },
      { flag: '--json DATA', summary: 'Send JSON and ask for JSON back' },
      { flag: '-o FILE, -O', summary: 'Write to a file, or to the remote name' },
      { flag: '-L', summary: 'Follow redirects' },
      { flag: '-s, -S', summary: 'Silent, but still show errors' },
      { flag: '-i, -I', summary: 'Include the response headers, or fetch only them' },
      { flag: '-u USER:PASS', summary: 'Basic authentication' },
      { flag: '-f', summary: 'Fail with an exit code on HTTP errors' },
    ],
    examples: [
      { command: 'curl -sSfL https://example.com/install.sh -o install.sh', summary: 'Download a script safely, then read it before running it' },
      { command: "curl -X POST -H 'Content-Type: application/json' -d '{\"ok\":true}' localhost:3000/api", summary: 'Post JSON to a local API' },
      { command: 'curl -I https://example.com', summary: 'Headers only -- check a redirect or a cache header' },
    ],
    danger: 'Piping a downloaded script straight into a shell runs code you have not read.',
    seeAlso: ['wget', 'httpie', 'jq', 'nc', 'ssh'],
  }),
  cmd('wget', 'Network', 'Download files over HTTP, HTTPS and FTP', 'wget [OPTION]... URL...', {
    options: [
      { flag: '-c', summary: 'Continue a partial download' },
      { flag: '-O FILE', summary: 'Write to this name' },
      { flag: '-r -np', summary: 'Recursive, without climbing to the parent directory' },
      { flag: '-q', summary: 'Quiet' },
    ],
    examples: [{ command: 'wget -c https://example.com/big.iso', summary: 'Resume an interrupted download' }],
    seeAlso: ['curl', 'aria2c', 'rsync'],
  }),
  cmd('http', 'Network', 'HTTPie -- a human-friendly HTTP client', 'http [OPTION]... METHOD URL [ITEM]...', { aliases: ['httpie'], seeAlso: ['curl', 'jq'] }),
  cmd('ssh', 'Network', 'Log in to or run a command on a remote machine', 'ssh [OPTION]... [USER@]HOST [COMMAND]', {
    options: [
      { flag: '-p PORT', summary: 'Connect to a non-standard port' },
      { flag: '-i KEYFILE', summary: 'Use a specific private key' },
      { flag: '-L LOCAL:HOST:REMOTE', summary: 'Forward a local port to the remote side' },
      { flag: '-R REMOTE:HOST:LOCAL', summary: 'Forward a remote port back to you' },
      { flag: '-N', summary: 'No command -- for tunnels' },
      { flag: '-A', summary: 'Forward the agent (only to hosts you trust)' },
      { flag: '-v', summary: 'Verbose; -vvv when authentication is failing' },
    ],
    examples: [
      { command: 'ssh -L 8080:localhost:80 user@server -N', summary: 'Reach a remote web server at localhost:8080' },
      { command: "ssh user@server 'systemctl status nginx'", summary: 'Run one command and come straight back' },
    ],
    seeAlso: ['scp', 'sftp', 'ssh-keygen', 'ssh-copy-id', 'mosh', 'rsync'],
  }),
  cmd('scp', 'Network', 'Copy files over SSH', 'scp [OPTION]... SOURCE... TARGET', {
    options: [{ flag: '-r', summary: 'Copy directories' }, { flag: '-P PORT', summary: 'Non-standard port (capital P, unlike ssh)' }],
    examples: [{ command: 'scp -r ./dist user@server:/srv/app', summary: 'Ship a build directory' }],
    seeAlso: ['rsync', 'sftp', 'ssh'],
  }),
  cmd('sftp', 'Network', 'An interactive file transfer session over SSH', 'sftp [OPTION]... [USER@]HOST', { seeAlso: ['scp', 'rsync', 'ftp'] }),
  cmd('ssh-keygen', 'Network', 'Create and manage SSH keys', 'ssh-keygen [OPTION]...', {
    options: [
      { flag: '-t ed25519', summary: 'The key type to prefer today' },
      { flag: '-C COMMENT', summary: 'Label the key, usually with an email' },
      { flag: '-R HOST', summary: 'Remove a host from known_hosts after it changed' },
    ],
    examples: [{ command: 'ssh-keygen -t ed25519 -C "you@example.com"', summary: 'Generate a modern key pair' }],
    seeAlso: ['ssh', 'ssh-copy-id', 'ssh-agent'],
  }),
  cmd('ssh-copy-id', 'Network', 'Install your public key on a remote account', 'ssh-copy-id [OPTION]... [USER@]HOST', { seeAlso: ['ssh-keygen', 'ssh'] }),
  cmd('ssh-agent', 'Network', 'Hold decrypted private keys for the session', 'ssh-agent [OPTION]... [COMMAND]', { seeAlso: ['ssh-add', 'ssh'] }),
  cmd('ssh-add', 'Network', 'Add a private key to the agent', 'ssh-add [OPTION]... [KEYFILE]...', { seeAlso: ['ssh-agent'] }),
  cmd('mosh', 'Network', 'A roaming remote shell that survives changing networks', 'mosh [OPTION]... [USER@]HOST', { seeAlso: ['ssh', 'tmux'] }),
  cmd('ping', 'Network', 'Send ICMP echo requests to a host', 'ping [OPTION]... HOST', {
    options: [{ flag: '-c N', summary: 'Stop after N packets' }, { flag: '-i SECONDS', summary: 'Interval between packets' }],
    examples: [{ command: 'ping -c 4 1.1.1.1', summary: 'Four packets -- is the network up at all' }],
    seeAlso: ['traceroute', 'mtr', 'dig', 'nc'],
  }),
  cmd('traceroute', 'Network', 'Show the route packets take to a host', 'traceroute [OPTION]... HOST', { seeAlso: ['ping', 'mtr', 'tracepath'] }),
  cmd('mtr', 'Network', 'A live traceroute and ping combined', 'mtr [OPTION]... HOST', { seeAlso: ['traceroute', 'ping'] }),
  cmd('dig', 'Network', 'Query DNS', 'dig [@SERVER] [OPTION]... NAME [TYPE]', {
    options: [
      { flag: '+short', summary: 'Just the answer' },
      { flag: '+trace', summary: 'Follow the delegation from the root' },
      { flag: '-x ADDRESS', summary: 'Reverse lookup' },
    ],
    examples: [{ command: 'dig +short example.com A', summary: 'The address, with nothing else' }],
    seeAlso: ['nslookup', 'host', 'getent', 'whois'],
  }),
  cmd('nslookup', 'Network', 'Query DNS interactively', 'nslookup [OPTION]... [NAME] [SERVER]', { seeAlso: ['dig', 'host'] }),
  cmd('host', 'Network', 'A simple DNS lookup', 'host [OPTION]... NAME [SERVER]', { seeAlso: ['dig', 'nslookup'] }),
  cmd('whois', 'Network', 'Look up domain and address registration', 'whois [OPTION]... OBJECT', { seeAlso: ['dig'] }),
  cmd('ip', 'Network', 'Show and configure addresses, links and routes', 'ip [OPTION]... OBJECT COMMAND', {
    description: 'The modern replacement for ifconfig, route and arp.',
    options: [
      { flag: 'addr', summary: 'Addresses: `ip a` is the everyday form' },
      { flag: 'link', summary: 'Interfaces: up, down, MAC addresses' },
      { flag: 'route', summary: 'The routing table' },
      { flag: 'neigh', summary: 'The ARP cache' },
    ],
    examples: [{ command: 'ip -br a', summary: 'A one-line-per-interface summary' }],
    seeAlso: ['ifconfig', 'ss', 'ping', 'nmcli'],
  }),
  cmd('ifconfig', 'Network', 'Configure a network interface (superseded by ip)', 'ifconfig [INTERFACE] [OPTION]...', { seeAlso: ['ip'] }),
  cmd('ss', 'Network', 'Show sockets: listening ports and established connections', 'ss [OPTION]... [FILTER]', {
    options: [
      { flag: '-t, -u', summary: 'TCP, UDP' },
      { flag: '-l', summary: 'Listening only' },
      { flag: '-n', summary: 'Numeric -- do not resolve names' },
      { flag: '-p', summary: 'Show the owning process' },
    ],
    examples: [{ command: 'ss -tulpn', summary: 'Everything listening, with the process that owns it' }],
    seeAlso: ['netstat', 'lsof', 'ip', 'nc'],
  }),
  cmd('netstat', 'Network', 'Show network connections and statistics (superseded by ss)', 'netstat [OPTION]...', { seeAlso: ['ss', 'lsof'] }),
  cmd('nc', 'Network', 'Read and write raw TCP and UDP connections', 'nc [OPTION]... [HOST] [PORT]', {
    options: [
      { flag: '-l', summary: 'Listen instead of connecting' },
      { flag: '-z', summary: 'Scan without sending data' },
      { flag: '-v', summary: 'Verbose' },
      { flag: '-w SECONDS', summary: 'Timeout' },
    ],
    examples: [{ command: 'nc -zv localhost 5173', summary: 'Is anything actually accepting on that port' }],
    seeAlso: ['ss', 'socat', 'telnet', 'nmap'],
  }),
  cmd('socat', 'Network', 'Relay data between two endpoints of almost any kind', 'socat [OPTION]... ADDRESS ADDRESS', { seeAlso: ['nc', 'ssh'] }),
  cmd('telnet', 'Network', 'Connect to a TCP port and talk to it by hand', 'telnet [HOST [PORT]]', { seeAlso: ['nc', 'ssh'] }),
  cmd('nmap', 'Network', 'Scan hosts for open ports and services', 'nmap [OPTION]... TARGET', {
    danger: 'Scanning machines you do not own is, in many places, illegal.',
    options: [{ flag: '-sV', summary: 'Probe for service versions' }, { flag: '-p PORTS', summary: 'Which ports to scan' }],
    seeAlso: ['nc', 'ss'],
  }),
  cmd('tcpdump', 'Network', 'Capture and print network packets', 'tcpdump [OPTION]... [FILTER]', {
    options: [
      { flag: '-i INTERFACE', summary: 'Which interface, or `any`' },
      { flag: '-n', summary: 'Do not resolve names' },
      { flag: '-w FILE', summary: 'Write a capture file for Wireshark' },
      { flag: '-A', summary: 'Print packet payloads as text' },
    ],
    examples: [{ command: 'sudo tcpdump -i any -n port 5432', summary: 'Watch database traffic' }],
    seeAlso: ['wireshark', 'tshark', 'ss'],
  }),
  cmd('tshark', 'Network', 'The command-line Wireshark', 'tshark [OPTION]...', { seeAlso: ['tcpdump', 'wireshark'] }),
  cmd('iptables', 'Network', 'Configure the older Linux packet filter', 'iptables [-t TABLE] COMMAND CHAIN RULE', { danger: 'A wrong rule on a remote machine can lock you out. Schedule a rollback before applying one.', seeAlso: ['nft', 'ufw', 'firewall-cmd'] }),
  cmd('nft', 'Network', 'Configure nftables, the modern Linux packet filter', 'nft [OPTION]... COMMAND', { danger: 'Same warning as iptables: you are editing the rules that keep your own session alive.', seeAlso: ['iptables', 'ufw'] }),
  cmd('ufw', 'Network', 'An uncomplicated front end for the firewall', 'ufw [OPTION]... COMMAND', {
    options: [{ flag: 'allow PORT', summary: 'Open a port' }, { flag: 'status numbered', summary: 'List the rules with indexes' }],
    danger: '`ufw enable` on a remote box without allowing SSH first will disconnect you.',
    seeAlso: ['iptables', 'firewall-cmd'],
  }),
  cmd('firewall-cmd', 'Network', 'Manage firewalld zones and rules', 'firewall-cmd [OPTION]...', { seeAlso: ['ufw', 'iptables'] }),
  cmd('nmcli', 'Network', 'Control NetworkManager from the command line', 'nmcli [OPTION]... OBJECT COMMAND', { seeAlso: ['ip', 'iwctl'] }),
  cmd('iw', 'Network', 'Configure wireless devices', 'iw [OPTION]... COMMAND', { seeAlso: ['nmcli', 'iwctl'] }),
  cmd('arp', 'Network', 'Show or edit the ARP cache (superseded by `ip neigh`)', 'arp [OPTION]...', { seeAlso: ['ip'] }),
  cmd('route', 'Network', 'Show or edit the routing table (superseded by `ip route`)', 'route [OPTION]...', { seeAlso: ['ip'] }),
  cmd('openssl', 'Network', 'A toolkit for TLS, certificates, keys and hashing', 'openssl COMMAND [OPTION]...', {
    options: [
      { flag: 's_client -connect HOST:443', summary: 'Open a TLS connection and show the certificate chain' },
      { flag: 'x509 -in CERT -text -noout', summary: 'Read a certificate' },
      { flag: 'rand -hex 32', summary: 'Generate a random secret' },
    ],
    examples: [{ command: 'openssl s_client -connect example.com:443 -servername example.com </dev/null | openssl x509 -noout -dates', summary: 'When does this certificate expire' }],
    seeAlso: ['curl', 'gpg', 'certbot', 'sha256sum'],
  }),
  cmd('gpg', 'Network', 'Encrypt, decrypt and sign data', 'gpg [OPTION]... [FILE]...', {
    options: [
      { flag: '--verify SIG FILE', summary: 'Check a signature' },
      { flag: '-c', summary: 'Encrypt with a passphrase' },
      { flag: '--list-keys', summary: 'Show the keyring' },
    ],
    seeAlso: ['openssl', 'age', 'sha256sum'],
  }),
  cmd('age', 'Network', 'Simple modern file encryption', 'age [OPTION]... [FILE]', { seeAlso: ['gpg', 'openssl'] }),
  cmd('certbot', 'Network', 'Obtain and renew Let’s Encrypt certificates', 'certbot [SUBCOMMAND] [OPTION]...', { seeAlso: ['openssl', 'curl'] }),
  cmd('rclone', 'Network', 'Sync files with cloud storage providers', 'rclone [OPTION]... SUBCOMMAND SOURCE DEST', { seeAlso: ['rsync', 'aws'] }),
  cmd('aria2c', 'Network', 'A multi-connection download utility', 'aria2c [OPTION]... URI...', { seeAlso: ['wget', 'curl'] }),
  cmd('speedtest', 'Network', 'Measure internet bandwidth from the command line', 'speedtest [OPTION]...', { seeAlso: ['iperf3', 'ping'] }),
  cmd('ftp', 'Network', 'An interactive FTP client', 'ftp [OPTION]... [HOST]', { seeAlso: ['sftp', 'curl'] }),
  cmd('iperf3', 'Network', 'Measure throughput between two machines', 'iperf3 [-s | -c HOST] [OPTION]...', { seeAlso: ['speedtest', 'nc'] }),
]
