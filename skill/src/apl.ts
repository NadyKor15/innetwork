// APL card "Your checkup year" for a real Echo Show, built from the checkup_year tool's card (screen 02 data).
// Same tokens as the MCP App screens (STYLE.md §3): dark #14181E surfaces, mom's coral as a left bar, outline
// check for booked, "?" for "may need an order". APL has no web fonts: the device font is used.
export type CheckupCard = { title: string; subtitle: string; source: string; items: { item: string; status: string; text: string; detail: string | null }[] };

const C = { screen: "#14181E", inner: "#1B2028", hairline: "#2A303A", text1: "#FFFFFF", text2: "#FFFFFFB8", text3: "#FFFFFF7A", mom: "#FF8C6B", fits: "#7FE0A8", unknown: "#F2D06B" };

export function checkupDocument() {
  return {
    type: "APL", version: "2024.3",
    theme: "dark",
    mainTemplate: {
      parameters: ["payload"],
      items: [{
        type: "Container", width: "100vw", height: "100vh", paddingLeft: "40dp", paddingRight: "40dp", paddingTop: "28dp", backgroundColor: C.screen,
        items: [
          { type: "Container", direction: "row", alignItems: "center", items: [
            { type: "Frame", width: "18dp", height: "18dp", borderRadius: "9dp", backgroundColor: "#FF8C6B" },
            { type: "Frame", width: "18dp", height: "18dp", borderRadius: "9dp", backgroundColor: "#B49CFF", spacing: "-4dp" },
            { type: "Frame", width: "18dp", height: "18dp", borderRadius: "9dp", backgroundColor: "#4FD1C5", spacing: "-4dp" },
            { type: "Text", text: "InNetwork", fontSize: "20dp", fontWeight: "700", color: C.text1, spacing: "10dp" },
          ] },
          { type: "Text", text: "${payload.card.title}", fontSize: "44dp", fontWeight: "800", color: C.text1, spacing: "18dp" },
          { type: "Text", text: "${payload.card.subtitle}", fontSize: "22dp", color: C.text2, spacing: "6dp" },
          { type: "Text", text: "${payload.card.source}", fontSize: "18dp", color: C.text3, spacing: "4dp" },
          { type: "Sequence", width: "100%", grow: 1, spacing: "16dp", data: "${payload.card.items}", items: [{
            type: "Container", direction: "row", alignItems: "center", height: "62dp", spacing: "8dp", paddingLeft: "14dp", paddingRight: "14dp", borderRadius: "12dp", borderWidth: "1dp", borderColor: C.hairline, backgroundColor: C.inner,
            items: [
              { type: "Frame", width: "6dp", height: "30dp", borderRadius: "3dp", backgroundColor: C.mom },
              { type: "Text", text: "Mom", fontSize: "20dp", color: C.text2, width: "90dp", spacing: "14dp" },
              { type: "Text", text: "${data.item}", fontSize: "24dp", fontWeight: "700", color: C.text1, grow: 1 },
              { type: "Text", text: "${data.status == 'may_need_order' ? '?' : '✓'}", fontSize: "26dp", fontWeight: "800", color: "${data.status == 'may_need_order' ? '" + C.unknown + "' : '" + C.fits + "'}", width: "36dp", textAlign: "center" },
              { type: "Text", text: "${data.text}${data.detail ? ' · ' + data.detail : ''}", fontSize: "22dp", color: C.text1, width: "52%" },
            ],
          }] },
          { type: "Text", text: "demo data · Alexa+ add-on simulated; this classic skill shows the same saved plan", fontSize: "16dp", color: C.text3, paddingBottom: "16dp" },
        ],
      }],
    },
  };
}
