function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function cleanName(value) {
  if (!value) return "";
  return String(value).replace(/\s*\(?\d{4,}\)?\s*$/g, "").trim();
}

export function getFullName(user) {
  const firstName = pickFirst(
    user.firstName,
    user.first_name,
    user.firstname,
    user.givenName,
    user.given_name,
    user.profile?.firstName,
    user.profile?.first_name,
    user.personal?.firstName,
    user.personal?.first_name,
  );

  const lastName = pickFirst(
    user.lastName,
    user.last_name,
    user.lastname,
    user.surname,
    user.familyName,
    user.family_name,
    user.profile?.lastName,
    user.profile?.last_name,
    user.personal?.lastName,
    user.personal?.last_name,
  );

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return (
    cleanName(fullName) ||
    cleanName(user.fullName) ||
    cleanName(user.full_name) ||
    cleanName(user.realName) ||
    cleanName(user.real_name) ||
    cleanName(user.name) ||
    cleanName(user.publicNickname) ||
    `VID ${user.id}`
  );
}

function getDivisionId(position) {
  const division = position?.division || position?.divisionStaffPosition?.division;
  return String(
    pickFirst(
      division?.id,
      division?.code,
      position?.divisionId,
      position?.division_id,
      "",
    ),
  ).toUpperCase();
}

export function getStaffPositionName(position) {
  const staffPosition = position?.staffPosition || position?.staff_position || position;
  const divisionId = getDivisionId(position);

  const name = pickFirst(
    staffPosition?.shortName,
    staffPosition?.short_name,
    staffPosition?.name,
    position?.shortName,
    position?.short_name,
    position?.name,
    staffPosition?.code,
    position?.code,
    staffPosition?.id,
    position?.id,
  );

  if (name && divisionId && !String(name).toUpperCase().startsWith(`${divisionId}-`)) {
    return `${divisionId}-${name}`;
  }
  return name || null;
}

function compactPositionFallback(value, divisionId) {
  const upper = String(value || "").trim().toUpperCase();
  if (!upper) return divisionId ? `${divisionId}-STAFF` : null;
  if (/^[A-Z]{2,4}-[A-Z0-9]{1,10}$/.test(upper)) return upper;

  const body = upper
    .replace(new RegExp(`^${divisionId || "TH"}[-\\s]+`), "")
    .replace(/^DIVISION[-\s]+/, "");
  const ignored = new Set(["DIVISION", "DEPARTMENT", "STAFF", "TEAM", "OF", "THE"]);
  const words = body
    .split(/[\s/_-]+/)
    .map((word) => word.replace(/[^A-Z0-9]/g, ""))
    .filter((word) => word && !ignored.has(word));

  const acronym = words.map((word) => word[0]).join("").slice(0, 6);
  return acronym ? `${divisionId || "TH"}-${acronym}` : `${divisionId || "TH"}-STAFF`;
}

export function getStaffPositionCode(position) {
  const staffPosition = position?.staffPosition || position?.staff_position || position;
  const divisionId = getDivisionId(position) || "TH";
  const candidates = [
    staffPosition?.code,
    position?.code,
    staffPosition?.shortName,
    staffPosition?.short_name,
    position?.shortName,
    position?.short_name,
    staffPosition?.id,
    position?.id,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim().toUpperCase();
    if (!value) continue;
    if (/^[A-Z]{2,4}-[A-Z0-9]{1,10}$/.test(value)) return value;
    if (/^[A-Z0-9]{1,8}$/.test(value)) return `${divisionId}-${value}`;
  }

  return compactPositionFallback(getStaffPositionName(position), divisionId);
}

export function isThailandStaffPosition(position) {
  const divisionId = getDivisionId(position);
  const positionName = String(getStaffPositionName(position) || "").toUpperCase();
  return divisionId === "TH" || positionName.startsWith("TH-");
}

export function buildSessionFromIvaoUser(user) {
  const allStaffPositions = Array.isArray(user.userStaffPositions) ? user.userStaffPositions : [];
  const thailandStaffPositions = allStaffPositions.filter(isThailandStaffPosition);
  const divisionId = String(user.divisionId || user.division?.id || "").toUpperCase() || null;
  const isIvaoStaff = Boolean(user.isStaff || allStaffPositions.length > 0);
  const isThailandStaff = Boolean(
    thailandStaffPositions.length > 0 || (user.isStaff && divisionId === "TH"),
  );

  return {
    id: user.id,
    vid: String(user.id),
    name: getFullName(user),
    publicNickname: user.publicNickname || null,
    divisionId,
    countryId: user.countryId || user.country?.id || null,
    atcRating: user.rating?.atcRating?.shortName || null,
    pilotRating: user.rating?.pilotRating?.shortName || null,
    isIvaoStaff,
    isThailandStaff,
    role: isThailandStaff ? "STAFF" : "MEMBER",
    staffPositions: thailandStaffPositions.map(getStaffPositionName).filter(Boolean),
    staffPositionCodes: thailandStaffPositions.map(getStaffPositionCode).filter(Boolean),
    createdAt: new Date().toISOString(),
  };
}
