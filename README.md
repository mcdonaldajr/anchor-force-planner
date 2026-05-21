# Anchor Force Planner

Local web app version of `Anchor Force.xlsx`.

It calculates anchor wind load, tidal-stream load, HW-set rode length, per-tide-state scope, estimated combined chain/rope catenary, seabed rode, rope-on-seabed risk, weight to lift, tide-derived or echo-sounder depth now, and keel clearance. Boat-specific constants live on the **Settings** tab. The **Tide** tab accepts Oban HW/LW times and heights, can apply user-entered secondary-port corrections, and estimates tide rise now with the rule of twelfths. The **Tide Data** tab can fetch seven-day Oban tide events from the ADMIRALTY UK Tidal API; when fetched events are available, the app automatically uses the bracketing previous and following tide events for the present time.

Use **Save settings** to make the current planner, tide, and boat settings the defaults for this browser.

Settings includes boat constants, editable chain/rope reference values, whether the echo sounder reports depth beneath the keel or actual water depth from the surface, and system settings such as the UKHO API key and UT/local display mode. New installs default to local time display and 1.2 m draft.

The anchor drag check uses the entered anchor UHC as ideal near-horizontal holding, then reduces it for the estimated high-water pull angle before comparing it with wind plus tidal-stream load.

The **About** tab shows the web and server version numbers so you can check whether a Lubuntu machine has the latest pull.

Tide source, Oban tide entries, selected secondary port, secondary-port correction table, deleted built-in port ids, Tide Data settings, and fetched tide rows are stored on the server in `data/anchor-force-state.json`. Provider cache files live under `data/cache/`.

## Model Notes

These calculations are planning estimates, not certified engineering or a substitute for local judgement.

- Wind load uses a drag equation estimate: `0.0165 * projectedWindageArea * windSpeed^2`, where projected windage area is estimated as `LOA^2 * windageFactor`. The default windage factor is deliberately conservative for a 10 m cruising yacht; adjust it if you know the boat's projected windage.
- Tidal-stream load uses the same drag-equation approach in water: `13.2 * LOA * draft * underwaterDragFactor * tidalStream^2`.
- Tide rise uses the rule of twelfths between the previous and following downloaded tide events where available, falling back to the entered LW and HW. It is a quick interpolation only; tide curves, barometric pressure, surge, river flow, and local effects can make real water levels differ.
- Tide Data uses Oban UKHO station `0372` by default. The ADMIRALTY API key is stored only on the local server or read from `UKHO_API_KEY`; it is not returned to the browser. UKHO tide events are cached once per day. Downloaded event times are treated and stored as UT. The system display setting can show those times, Tide tab HW/LW inputs, and the tide graph in either UT or this browser's local time without changing the stored UT values.
- Secondary-port time differences use the almanac-style 0000/0600/1200/1800 columns and interpolate by the standard-port event time. Secondary-port height differences use the MHWS/MHWN/MLWN/MLWS columns and interpolate by the entered Oban reference levels. `% Spring` is calculated from the tide range between neighbouring HW/LW events where possible, and can be below 0% or above 100%.
- Built-in editable secondary ports currently include Tobermory, Port Ellen, and Loch Melfort from user-entered almanac-style data. Where LW time corrections were not supplied, the app uses the same fixed offset as HW or 0 minutes and records that caveat in the port note. The app does not bundle UKHO/Reeds correction tables; enter only data you are licensed to use.
- Catenary is estimated separately for lifted chain and lifted rope. Surplus rode can lie on the seabed, and the diagram caps deployed rode at chain plus rope carried.
- Anchor holding is highly seabed- and set-dependent. The UHC input should be treated as an ideal near-horizontal holding value. The app applies a simple pull-angle reduction, but it cannot model seabed type, veering, snatch loads, yawing, fouling, weed, or shock loading.

## Model References

- NASA Glenn Research Center, [The Drag Equation](https://www.grc.nasa.gov/www/k-12/VirtualAero/BottleRocket/airplane/drageq.html): basis for the wind and tidal-stream drag models.
- NOAA National Ocean Service, [Tides and Currents](https://oceanservice.noaa.gov/navigation/tidesandcurrents/): tide height and tidal current are related but distinct navigation data.
- NOAA Tides & Currents, [FAQ](https://tidesandcurrents.noaa.gov/faq.html): do not assume slack water or peak tidal current occurs exactly at HW/LW.
- BoatUS Foundation, [Docking study guide](https://boatus.org/study-guide/navigation/docking): standard anchoring scope guidance and bow-to-bottom scope definition.
- boats.com, [Anchoring Essentials](https://www.boats.com/anchoring-essentials/): wind load rises with wind speed squared and can become large quickly on cruising boats.

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

The Lubuntu desktop icon starts the server in the background, opens Firefox to the app, and does not leave a shell window open.

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

## Updating On Lubuntu

From the app folder:

```sh
git stash push -m "local changes before update"
git pull
chmod +x scripts/start-lubuntu.sh scripts/install-lubuntu.sh
./scripts/install-lubuntu.sh
```

Then launch from the desktop icon again and check **About**. The web and server versions should match.

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
