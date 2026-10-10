# Havaida Games

Kuusi pientä selainpeliä IT-twistillä – portfolio-/työnhakuprojekti, jossa jokainen peli on
teemoitettu yhden yrityksen ympärille ja lainaa mekaniikkansa sekä ulkoasunsa tunnetulta
mobiilipeliltä. Jokainen peli on ymmärrettävissä kymmenessä sekunnissa ja toimii sekä
työpöydällä että puhelimella.

| # | Peli | Yritys | Esikuva | Reitti |
| --- | --- | --- | --- | --- |
| 1 | **Ticket Slash** | Topteam IT | Fruit Ninja | `#/ticket-slash` |
| 2 | **Network Connect** | C2 | Flow Free | `#/network-connect` |
| 3 | **Access Crossing** | Hansab | Subway Surfers (3 kaistaa, juoksu selän takaa) | `#/access-crossing` |
| 4 | **Signal Command** | Puolustusvoimat | Helldivers 2 – Stratagem Hero (viestiverkon komentokoodit, ei sotapeli) | `#/signal-command` |
| 5 | **Bug Breaker** | Infomaatti | Angry Birds (Matter.js-fysiikka) | `#/bug-breaker` |
| 6 | **Uptime Keeper** | Ficolo | Overcooked-tyylinen ylhäältä kuvattu arcade | `#/uptime-keeper` |

Kuvakaappauksia: [`docs/screenshots/`](docs/screenshots/). Alkuperäiset konseptikuvat: [`docs/mockups/`](docs/mockups/).
Repo: [github.com/ClauterL/laikku-games](https://github.com/ClauterL/laikku-games) · Live: [clauterl.github.io/laikku-games](https://clauterl.github.io/laikku-games/)

## Käyttöönotto

```bash
npm install        # kerran
npm run dev        # http://localhost:5173  (hub + kaikki pelit)
npm run build      # tuotantoversio kansioon dist/
npm run preview    # dist/-version esikatselu
npm run check      # TypeScript-tyypitys (tsc --noEmit)
```

`dist/`-kansio on itsenäinen staattinen sivusto (`base: './'` + HashRouter), joten sen voi
kopioida sellaisenaan mihin tahansa:

- **laikku.com-alikansioon** (`laikku.com/games/`) – kopioi `dist/`-sisältö kansioon, ei muita muutoksia
- **GitHub Pages** – mukana on valmis työnkulku `.github/workflows/deploy.yml`: jokainen push `main`-haaraan
  buildaa pelit ja julkaisee ne osoitteeseen `https://clauterl.github.io/laikku-games/` (ensimmäinen ajo
  kytkee Pagesin päälle automaattisesti; jos se ei onnistu, valitse repon asetuksista Settings → Pages →
  Source: *GitHub Actions* ja aja työnkulku uudelleen)
- **Netlify / Vercel / Cloudflare Pages** – build-komento `npm run build`, julkaisukansio `dist`

Pelit eivät vaadi palvelinta: kaikki grafiikka piirretään canvasille, pisteet ja eteneminen
tallentuvat selaimen localStorageen. Ainoa ulkoinen riippuvuus ajon aikana on Google Fonts
(Baloo 2 + Nunito) – ilman verkkoa pelit käyttävät järjestelmäfontteja.

## Rakenne

```
index.html                 fontit, meta, #root
vite.config.ts             base './', matter-js esipaketoitu
src/
  main.tsx                 React-juuri (StrictMode)
  App.tsx                  HashRouter – hub + 6 laiskasti ladattua pelireittiä
  games.ts                 pelien metatiedot (nimi, yritys, värit, ohjeteksti)
  index.css                yhteinen design system: fontit, overlayt, napit, HUD-chipit
  hub/                     aloitussivu (pelikortit)
  shared/                  yhteiset moduulit (ks. alla)
  games/
    ticket-slash/          TicketSlash.tsx + engine.ts + render.ts + scene.ts + icons.ts + catalogue.ts
    network-connect/       NetworkConnect.tsx + engine.ts + generator.ts (+ generator.check.ts) + glyphs.ts
    access-crossing/       AccessCrossing.tsx + engine.ts + render.ts + spawner.ts + visitors.ts
    signal-command/        SignalCommand.tsx + engine.ts + commands.ts + sectors.ts + map.ts + fx.ts + finland.ts + assets/
    bug-breaker/           BugBreaker.tsx + engine.ts + sim.ts + draw.ts + levels.ts
    uptime-keeper/         UptimeKeeper.tsx + engine.ts + sim.ts (+ sim.check.ts) + render.ts + levels.ts + pathfind.ts
scripts/
  shoot.mjs                Playwright-savutesti: käynnistää dev-palvelimen, ottaa kuvakaappaukset
  scenarios/<peli>.mjs     pelikohtaiset pelausskenaariot (ajavat peliä oikeilla syötteillä)
docs/
  BRIEF.md                 kaikkien pelien yhteinen spesifikaatio ja laatulista
  games/<peli>.md          pelikohtaiset spesifikaatiot (mekaniikka, ulkoasu, testaus)
  mockups/                 konseptikuvat, screenshots/ valmiit kuvakaappaukset
```

Jokainen peli noudattaa samaa kaavaa: `engine.ts` on puhdasta TypeScriptiä ilman Reactia
(pelilogiikka, piirto, syötteet), ja React-komponentti hoitaa vain canvasin kiinnityksen,
HUD:n ja overlayt (`useEngine`-hook luo/tuhoaa moottorin, StrictMode-turvallisesti).

### Yhteiset moduulit (`src/shared/`)

| moduuli | tehtävä |
| --- | --- |
| `Overlay.tsx` | aloitus-/pause-/lopetusruutu (otsikko, ohje, tilastot, napit) |
| `HomeButton.tsx`, `MuteButton.tsx` | paluu hubiin, äänen vaimennus |
| `useEngine.ts` | pelimoottorin elinkaari React-komponentissa |
| `canvas.ts` | DPR-skaalaus (`fitCanvas`), `observeResize`, `startLoop` (pysähtyy taustavälilehdellä) |
| `draw.ts` | pyöristetyt laatikot, reunustettu teksti, hehku, partikkelit, leijuvat pistetekstit |
| `sfx.ts` | WebAudio-syntetisaattori – kaikki äänet luodaan koodilla, ei äänitiedostoja |
| `storage.ts` | localStorage-kääre (parhaat tulokset, eteneminen) |
| `rng.ts`, `math.ts` | siemennetty satunnaisgeneraattori (deterministiset tasot), easing-funktiot |

## Pelit lyhyesti

**Ticket Slash** – tikettejä lentää ruudulle Fruit Ninja -kaarissa; tartu tikettiin ja heitä se
oikeaan ratkaisulaatikkoon (VPN, Email, MFA, Printer, Backup, AD). Oikea = pisteet × combo,
väärä = combo nollaantuu, pudonnut = elämä pois. P1 CRITICAL -tiketti pitää ratkaista 5 s
sisällä. 60 s kierros, 3 elämää.

**Network Connect** – Flow Free -pulma: yhdistä jokainen USER omaan CLOUDiinsa, täytä kaikki
ruudut, älä risteä. Tasot generoidaan siemennetysti (aina ratkaistavissa – `generator.check.ts`
validoi 200 tasoa). Tasosta 3 alkaen välipisteitä (SWITCH/FIREWALL/SERVER), myöhemmin
palomuurilohkoja, packet lossia ja rikkinäisiä nodeja. Power-upit: Reroute, Firewall, VPN
Tunnel, Network Boost. Eteneminen tallentuu.

**Access Crossing** – Subway Surfers -tyylinen juoksupeli älyrakennuksessa: hahmo juoksee itse ja
kiihtyy, sinä vaihdat kaistaa, hyppäät ja liu'ut (pyyhkäisy tai nuolinäppäimet). Porttirivit vaativat
oikean kulkuoikeuden oikealla kaistalla (EMPLOYEE/VISITOR/CONTRACTOR/VIP/SECURITY 3+), kamerat
pyyhkäisevät käytävää punaisella keilalla, PIN-ovet vaativat lapulta poimitun koodin, vastaanotossa
tunnistetaan vierailija ja hissi vie seuraavaan kerrokseen vain oikealla kortilla. Kolikot, magneetti ja
vartijakilpi power-upeina. 3 sydäntä, kerrokset 1–5 ja sen jälkeen loputon.

**Signal Command** – Helldivers 2:n Stratagem Hero -pelikoneen idea Puolustusvoimien viestiverkkoon:
häiriö iskee verkkoon jossain päin Suomea ("Northern relay – SIGNAL LOST") ja korjaus on **komentokoodi**
eli nuolisarja (↑→↓→↑←), joka pitää näppäillä järjestyksessä ennen kuin aallon aika loppuu. Helpot koodit
ovat 3–4 nuolta, vaikeat 7–8; koodit ovat kiinteitä, joten ne voi opetella ulkoa. Väärä nuoli nollaa koodin
ja combon, virheetön ketju nostaa kertoimen x12:een, aallon loppuaika ja virheetön aalto (PERFECT!) tuovat
bonuksen. Viisi aaltoa sektoreittain (Helsinki → Turku → länsirannikko → Oulu → itä), sitten loputon.
Suomen kartta sektorinodeineen, kuusi järjestelmäpalkkia, 3 elämää, tarkkuus-%. Näppäimistö, D-pad tai
pyyhkäisyt. Ei vihollisia eikä aseita – pelkkää viestiliikenteen palauttamista. Taustakuvat (komentokeskus ja
sektorien tilannekuvat) on generoitu Higgsfieldillä (GPT Image 2.5); Suomen ääriviiva on Natural Earth
-aineistosta (`finland.ts`).

**Bug Breaker** – ritsalla koodikuutioita bugien rakennelmiin: HTML (perus), CSS (aluetörmäys),
JS (napauta ilmassa → räjähdys), Python (raskas + boost), SQL (läpäisee kerroksia). Puu/kivi/lasi
-palikoilla on kestopisteet, bugit (BUG, 404, NULL, SYNTAX ERROR) litistyvät iskuista. Kuusi
käsin rakennettua tasoa, tähdet jäljelle jääneistä laukauksista.

**Uptime Keeper** – ylhäältä kuvattu neon-datakeskus. Ficolo-teknikko juoksee räkkien välissä ja
pitää salin pystyssä: COOL laskee ylikuumenevan räkin lämpötilaa (rajallinen jäähdytyskapasiteetti),
REPAIR korjaa tuuletin-, virtalähde-, kytkin- ja PDU-viat (edistymisrengas), UPGRADE ostaa pysyviä
parannuksia – Server-taso tuo lisää pisteitä mutta myös lisää lämpöä ja virrankulutusta. Uptime-%
(kolmella desimaalilla) on päämittari; SLA pettää alle 98 %:n. Seitsemän tasoa 6 räkistä 28 räkin
saliin (redundantti jäähdytys, UPS, automaattinen valvonta), sitten loputon. `sim.check.ts` ajaa
simulaation headless-testinä.

## Testaus

```bash
npm run check                                   # tyypitys
node scripts/shoot.mjs --route /ticket-slash --port 5181 --out shots/ticket-slash \
     --scenario scripts/scenarios/ticket-slash.mjs
```

`shoot.mjs` käynnistää dev-palvelimen, avaa reitin 1280×800- ja 390×844-kokoisina, painaa PLAY,
ajaa skenaarion ja tallentaa kuvakaappaukset sekä raportoi konsolivirheet. Skripti tuo
Playwrightin absoluuttisesta polusta (`/opt/npm-tools/node_modules/playwright`) – omalla
koneella asenna `npm i -D playwright` ja vaihda import-rivi muotoon `from 'playwright'`.

## Muokkaus

- Hubin tekstit ja alatunniste: `src/hub/Hub.tsx` (yritykset ovat teemoja; alatunniste kertoo,
  ettei kyse ole virallisista peleistä).
- Pelien nimet, värit ja ohjetekstit: `src/games.ts`.
- Uusi peli: kopioi jonkin pelin kansio, lisää metatiedot `games.ts`-tiedostoon, reitti
  `App.tsx`-tiedostoon ja kortti-ikoni `Hub.tsx`-tiedostoon.

Yritysten nimet ovat pelien teemoja, eivät sponsoreita tai yhteistyökumppaneita; logoja ei ole
kopioitu – kaikki tunnukset ovat tekstipohjaisia.
