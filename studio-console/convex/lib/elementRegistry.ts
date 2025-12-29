export type RegistryField = {
    path: string;
    categoryHe: string;
    labelHe: string;
    valueType: "string" | "number" | "boolean" | "date" | "text";
};

export type RegistryBucket = {
    key: string;
    categoryHe: string;
    labelHe: string;
};

export type ElementTypeDef = {
    typeKey: string;
    labelHe: string;
};

export const ELEMENT_TYPES_V1: ElementTypeDef[] = [
    { typeKey: "studio_build", labelHe: "????? ??????" },
    { typeKey: "dressing_rental", labelHe: "????? ??????" },
    { typeKey: "transport", labelHe: "?????" },
    { typeKey: "installation", labelHe: "?????" },
    { typeKey: "shoot_day", labelHe: "??? ?????" },
    { typeKey: "dismantle", labelHe: "?????" },
    { typeKey: "pvc_floor", labelHe: "????? PVC" },
    { typeKey: "print_house", labelHe: "??? ????" },
    { typeKey: "subcontractor", labelHe: "???? ????" },
];

export const COMMON_FIELDS_V1: RegistryField[] = [
    { path: "meta.title", categoryHe: "???", labelHe: "?? ??????", valueType: "string" },
    { path: "meta.typeKey", categoryHe: "???", labelHe: "??? ??????", valueType: "string" },

    { path: "dimensions.widthCm", categoryHe: "?????", labelHe: "???? (??)", valueType: "number" },
    { path: "dimensions.heightCm", categoryHe: "?????", labelHe: "???? (??)", valueType: "number" },
    { path: "dimensions.depthCm", categoryHe: "?????", labelHe: "???? (??)", valueType: "number" },
    { path: "dimensions.diameterCm", categoryHe: "?????", labelHe: "???? (??)", valueType: "number" },
    { path: "dimensions.weightKg", categoryHe: "?????", labelHe: "???? (??)", valueType: "number" },
    { path: "dimensions.quantity", categoryHe: "?????", labelHe: "????", valueType: "number" },

    { path: "location.siteName", categoryHe: "?????", labelHe: "?? ???", valueType: "string" },
    { path: "location.siteAddress", categoryHe: "?????", labelHe: "????? ???", valueType: "string" },
    { path: "location.installArea", categoryHe: "?????", labelHe: "???? ?????", valueType: "text" },
    { path: "location.accessConstraints", categoryHe: "?????", labelHe: "?????? ????", valueType: "text" },

    { path: "schedule.installDate", categoryHe: "??" + "?", labelHe: "????? ?????", valueType: "date" },
    { path: "schedule.shootDate", categoryHe: "??" + "?", labelHe: "????? ?????", valueType: "date" },
    { path: "schedule.deadlineDate", categoryHe: "??" + "?", labelHe: "????? ???", valueType: "date" },

    { path: "procurement.budgetCapNis", categoryHe: "?????", labelHe: "???? ????? (?\"?)", valueType: "number" },
    { path: "procurement.vendorName", categoryHe: "?????", labelHe: "???", valueType: "string" },
    { path: "procurement.vendorContact", categoryHe: "?????", labelHe: "??? ???", valueType: "string" },
    { path: "procurement.purchaseNeeded", categoryHe: "?????", labelHe: "???? ?????", valueType: "boolean" },
    { path: "procurement.rentalNeeded", categoryHe: "?????", labelHe: "???? ?????", valueType: "boolean" },

    { path: "execution.requiresStudioWork", categoryHe: "?????", labelHe: "???? ????? ??????", valueType: "boolean" },
    { path: "execution.requiresInstallation", categoryHe: "?????", labelHe: "???? ?????", valueType: "boolean" },
    { path: "execution.requiresTransport", categoryHe: "?????", labelHe: "???? ?????", valueType: "boolean" },
    { path: "execution.requiresPrintHouse", categoryHe: "?????", labelHe: "???? ??? ????", valueType: "boolean" },
    { path: "execution.requiresSubcontractor", categoryHe: "?????", labelHe: "???? ???? ????", valueType: "boolean" },

    { path: "materials.keyMaterialsSummary", categoryHe: "??????", labelHe: "?????? ???????", valueType: "text" },
    { path: "materials.finishesSummary", categoryHe: "??????", labelHe: "???????", valueType: "text" },
];

export const FREE_TEXT_BUCKETS_V1: RegistryBucket[] = [
    { key: "designNotes", categoryHe: "?????", labelHe: "????? ?????" },
    { key: "constraints", categoryHe: "?????", labelHe: "??????" },
    { key: "risks", categoryHe: "???????", labelHe: "???????" },
    { key: "assumptions", categoryHe: "?????", labelHe: "?????" },
    { key: "openQuestions", categoryHe: "?????", labelHe: "????? ??????" },
    { key: "generalNotes", categoryHe: "?????", labelHe: "????? ??????" },
];

const FIELD_BY_PATH = new Map(COMMON_FIELDS_V1.map((field) => [field.path, field]));
const BUCKET_BY_KEY = new Map(FREE_TEXT_BUCKETS_V1.map((bucket) => [bucket.key, bucket]));
const ELEMENT_TYPE_BY_KEY = new Map(ELEMENT_TYPES_V1.map((entry) => [entry.typeKey, entry]));

export function getRegistryField(path: string) {
    return FIELD_BY_PATH.get(path) ?? null;
}

export function getBucketDefinition(key: string) {
    return BUCKET_BY_KEY.get(key) ?? null;
}

export function getElementTypeDefinition(typeKey: string) {
    return ELEMENT_TYPE_BY_KEY.get(typeKey) ?? null;
}

export function listRegistryFields() {
    return COMMON_FIELDS_V1.slice();
}

export function listBuckets() {
    return FREE_TEXT_BUCKETS_V1.slice();
}

export function listElementTypes() {
    return ELEMENT_TYPES_V1.slice();
}

export function isValidFieldPath(path: string) {
    return FIELD_BY_PATH.has(path);
}

export function isValidBucketKey(key: string) {
    return BUCKET_BY_KEY.has(key);
}

export function isRequiredField(path: string) {
    return path === "meta.title" || path === "meta.typeKey";
}
