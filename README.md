# Anchor Force Planner

Local web app version of `Anchor Force.xlsx`.

It calculates anchor wind load, tidal-stream load, HW-set rode length, per-tide-state scope, estimated chain catenary, seabed rode, rope-on-seabed risk, weight to lift, tide-derived depth now, and keel clearance. Boat-specific constants live on the **Boat Settings** tab. The **Tide** tab accepts local HW/LW times and heights for the anchorage and estimates tide rise now with the rule of twelfths.

## Quick Start

```sh
npm start
```

Then open:

```text
http://127.0.0.1:4184
```

## Lubuntu Install

Install dependencies:

```sh
sudo apt update
sudo apt install -y git nodejs npm
```

Clone and install the desktop launcher:

```sh
git clone https://github.com/mcdonaldajr/anchor-force-planner.git
cd anchor-force-planner
chmod +x scripts/install-lubuntu.sh
./scripts/install-lubuntu.sh
```

Start from the desktop icon, or run:

```sh
./scripts/start-lubuntu.sh
```

The Lubuntu launcher binds to `0.0.0.0`, so other devices on the same Wi-Fi can access it.

## iPad Access To Lubuntu Server

1. Start the app on Lubuntu with the desktop icon or `./scripts/start-lubuntu.sh`.
2. Keep the iPad and Lubuntu machine on the same Wi-Fi network.
3. The terminal prints one or more LAN URLs, for example:

```text
http://192.168.1.42:4184
```

4. Open that URL in Safari on the iPad.

If the iPad cannot connect, check the Lubuntu firewall:

```sh
sudo ufw allow 4184/tcp
```

## Windows Install

Install Node.js LTS from:

```text
https://nodejs.org/
```

Install Git for Windows from:

```text
https://git-scm.com/download/win
```

Open PowerShell, then run:

```powershell
git clone https://github.com/mcdonaldajr/anchor-force-planner.git
cd anchor-force-planner
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

Start from the desktop shortcut, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

Then open:

```text
http://127.0.0.1:4184
```

For LAN access from another device on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1 -Lan
```

You may also need to allow TCP port `4184` in Windows Defender Firewall.
