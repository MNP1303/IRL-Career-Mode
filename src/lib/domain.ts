/** Static football domain data shared by the engine, schemas and UI. */

export const ATTRIBUTE_KEYS = ["pac", "sho", "pas", "dri", "def", "phy"] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

export const ATTRIBUTES: Record<
  AttributeKey,
  { code: string; name: string; prompt: string }
> = {
  pac: { code: "PAC", name: "Pace", prompt: "Speed, acceleration, runs in behind" },
  sho: { code: "SHO", name: "Shooting", prompt: "Finishing and shot selection" },
  pas: { code: "PAS", name: "Passing", prompt: "Range, accuracy and vision" },
  dri: { code: "DRI", name: "Dribbling", prompt: "First touch, control, beating players" },
  def: { code: "DEF", name: "Defending", prompt: "Tackles, positioning, tracking back" },
  phy: { code: "PHY", name: "Physical", prompt: "Strength, stamina, duels" },
};

export const FORMATS = ["5v5", "7v7", "11v11"] as const;
export type MatchFormat = (typeof FORMATS)[number];

export const RESULTS = ["win", "draw", "loss"] as const;
export type MatchResult = (typeof RESULTS)[number];

export const RESULT_META: Record<MatchResult, { label: string; letter: string }> = {
  win: { label: "Win", letter: "W" },
  draw: { label: "Draw", letter: "D" },
  loss: { label: "Loss", letter: "L" },
};

export const POSITIONS = [
  "GK",
  "LB",
  "CB",
  "RB",
  "LWB",
  "RWB",
  "CDM",
  "LM",
  "CM",
  "RM",
  "CAM",
  "LW",
  "RW",
  "CF",
  "ST",
] as const;
export type Position = (typeof POSITIONS)[number];

export type PositionRole =
  | "gk"
  | "cb"
  | "fb"
  | "dm"
  | "cm"
  | "am"
  | "wing"
  | "st";

/**
 * x runs along the pitch towards the opposition goal (0–105m), y across it
 * from the player's left touchline (0–68m).
 */
export const POSITION_META: Record<
  Position,
  { name: string; role: PositionRole; line: "GK" | "DEF" | "MID" | "ATT"; x: number; y: number }
> = {
  GK: { name: "Goalkeeper", role: "gk", line: "GK", x: 6, y: 34 },
  LB: { name: "Left back", role: "fb", line: "DEF", x: 25, y: 10 },
  CB: { name: "Centre back", role: "cb", line: "DEF", x: 21, y: 34 },
  RB: { name: "Right back", role: "fb", line: "DEF", x: 25, y: 58 },
  LWB: { name: "Left wing back", role: "fb", line: "DEF", x: 41, y: 6 },
  RWB: { name: "Right wing back", role: "fb", line: "DEF", x: 41, y: 62 },
  CDM: { name: "Defensive midfield", role: "dm", line: "MID", x: 38, y: 34 },
  LM: { name: "Left midfield", role: "cm", line: "MID", x: 58, y: 13 },
  CM: { name: "Central midfield", role: "cm", line: "MID", x: 54, y: 34 },
  RM: { name: "Right midfield", role: "cm", line: "MID", x: 58, y: 55 },
  CAM: { name: "Attacking midfield", role: "am", line: "MID", x: 70, y: 34 },
  LW: { name: "Left winger", role: "wing", line: "ATT", x: 82, y: 10 },
  RW: { name: "Right winger", role: "wing", line: "ATT", x: 82, y: 58 },
  CF: { name: "Centre forward", role: "st", line: "ATT", x: 84, y: 34 },
  ST: { name: "Striker", role: "st", line: "ATT", x: 95, y: 34 },
};

/** Activity zones are painted on a fixed grid so maps can be aggregated. */
export const ZONE_COLS = 12;
export const ZONE_ROWS = 8;

export const PITCH = { length: 105, width: 68 } as const;

export const NATIONS: { code: string; name: string }[] = [
  { code: "ALB", name: "Albania" },
  { code: "ALG", name: "Algeria" },
  { code: "ARG", name: "Argentina" },
  { code: "AUS", name: "Australia" },
  { code: "AUT", name: "Austria" },
  { code: "BEL", name: "Belgium" },
  { code: "BIH", name: "Bosnia and Herzegovina" },
  { code: "BRA", name: "Brazil" },
  { code: "BUL", name: "Bulgaria" },
  { code: "CAN", name: "Canada" },
  { code: "CHI", name: "Chile" },
  { code: "CHN", name: "China" },
  { code: "CIV", name: "Côte d'Ivoire" },
  { code: "CMR", name: "Cameroon" },
  { code: "COD", name: "DR Congo" },
  { code: "COL", name: "Colombia" },
  { code: "CRC", name: "Costa Rica" },
  { code: "CRO", name: "Croatia" },
  { code: "CZE", name: "Czechia" },
  { code: "DEN", name: "Denmark" },
  { code: "ECU", name: "Ecuador" },
  { code: "EGY", name: "Egypt" },
  { code: "ENG", name: "England" },
  { code: "ESP", name: "Spain" },
  { code: "FIN", name: "Finland" },
  { code: "FRA", name: "France" },
  { code: "GER", name: "Germany" },
  { code: "GHA", name: "Ghana" },
  { code: "GRE", name: "Greece" },
  { code: "HUN", name: "Hungary" },
  { code: "IDN", name: "Indonesia" },
  { code: "IND", name: "India" },
  { code: "IRL", name: "Republic of Ireland" },
  { code: "IRN", name: "Iran" },
  { code: "IRQ", name: "Iraq" },
  { code: "ISL", name: "Iceland" },
  { code: "ITA", name: "Italy" },
  { code: "JAM", name: "Jamaica" },
  { code: "JPN", name: "Japan" },
  { code: "KEN", name: "Kenya" },
  { code: "KOR", name: "South Korea" },
  { code: "KSA", name: "Saudi Arabia" },
  { code: "MAR", name: "Morocco" },
  { code: "MEX", name: "Mexico" },
  { code: "NED", name: "Netherlands" },
  { code: "NGA", name: "Nigeria" },
  { code: "NIR", name: "Northern Ireland" },
  { code: "NOR", name: "Norway" },
  { code: "NZL", name: "New Zealand" },
  { code: "PAK", name: "Pakistan" },
  { code: "PAR", name: "Paraguay" },
  { code: "PER", name: "Peru" },
  { code: "PHI", name: "Philippines" },
  { code: "POL", name: "Poland" },
  { code: "POR", name: "Portugal" },
  { code: "QAT", name: "Qatar" },
  { code: "ROU", name: "Romania" },
  { code: "RSA", name: "South Africa" },
  { code: "SCO", name: "Scotland" },
  { code: "SEN", name: "Senegal" },
  { code: "SRB", name: "Serbia" },
  { code: "SUI", name: "Switzerland" },
  { code: "SVK", name: "Slovakia" },
  { code: "SVN", name: "Slovenia" },
  { code: "SWE", name: "Sweden" },
  { code: "TRI", name: "Trinidad and Tobago" },
  { code: "TUN", name: "Tunisia" },
  { code: "TUR", name: "Türkiye" },
  { code: "UAE", name: "United Arab Emirates" },
  { code: "UKR", name: "Ukraine" },
  { code: "URU", name: "Uruguay" },
  { code: "USA", name: "United States" },
  { code: "VEN", name: "Venezuela" },
  { code: "VIE", name: "Vietnam" },
  { code: "WAL", name: "Wales" },
  { code: "ZIM", name: "Zimbabwe" },
];

export function nationName(code: string) {
  return NATIONS.find((nation) => nation.code === code)?.name ?? code;
}
