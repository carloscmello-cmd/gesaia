import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_EDITABLE_KEYS,
  AD_FIELD_TYPES,
  AD_STRING_KEYS,
  hydrateAdditionalData,
  mergeAdditionalData,
} from "./riskPersistence.ts";

test("additionalData fields have one explicit numeric or string classification", () => {
  assert.deepEqual(
    new Set([...AD_EDITABLE_KEYS, ...AD_STRING_KEYS]),
    new Set(Object.keys(AD_FIELD_TYPES)),
  );
  assert.equal(
    new Set(AD_EDITABLE_KEYS).size + new Set(AD_STRING_KEYS).size,
    Object.keys(AD_FIELD_TYPES).length,
  );
  assert.ok(AD_STRING_KEYS.includes("risk1Name"));
  assert.ok(AD_STRING_KEYS.includes("stageName5"));
});

test("risk names survive opening, saving unchanged, and reopening a period", () => {
  const existingPeriod = {
    period: "2026-08",
    additionalData: {
      risk1Name: "Inadimplência de clientes",
      risk1Probability: 40,
      risk1Impact: 50000,
      risk2Name: "Perda de fornecedor",
      risk2Probability: 25,
      risk2Impact: 20000,
    },
  };

  const populatedForm = hydrateAdditionalData(existingPeriod.additionalData);
  assert.equal(populatedForm.ad_risk1Name, "Inadimplência de clientes");
  assert.equal(populatedForm.ad_risk2Name, "Perda de fornecedor");

  const savedAdditionalData = mergeAdditionalData(
    existingPeriod.additionalData,
    populatedForm,
  );
  assert.equal(savedAdditionalData.risk1Name, "Inadimplência de clientes");
  assert.equal(savedAdditionalData.risk2Name, "Perda de fornecedor");
  assert.equal(savedAdditionalData.risk1Probability, 40);
  assert.equal(savedAdditionalData.risk2Impact, 20000);

  const reopenedForm = hydrateAdditionalData(savedAdditionalData);
  assert.equal(reopenedForm.ad_risk1Name, "Inadimplência de clientes");
  assert.equal(reopenedForm.ad_risk2Name, "Perda de fornecedor");
});

test("stage names survive opening, saving without editing Operações, and reopening a period", () => {
  const existingPeriod = {
    period: "2026-08",
    additionalData: {
      stageName1: "Prospecção",
      stageName2: "Qualificação",
      stageName3: "Entrega",
      stageCap1: 100,
      stageCap2: 80,
      stageCap3: 60,
    },
  };

  const populatedForm = hydrateAdditionalData(existingPeriod.additionalData);
  assert.equal(populatedForm.ad_stageName1, "Prospecção");
  assert.equal(populatedForm.ad_stageName2, "Qualificação");
  assert.equal(populatedForm.ad_stageName3, "Entrega");

  const savedAdditionalData = mergeAdditionalData(
    existingPeriod.additionalData,
    populatedForm,
  );
  assert.equal(savedAdditionalData.stageName1, "Prospecção");
  assert.equal(savedAdditionalData.stageName2, "Qualificação");
  assert.equal(savedAdditionalData.stageName3, "Entrega");
  assert.equal(savedAdditionalData.stageCap1, 100);
  assert.equal(savedAdditionalData.stageCap2, 80);
  assert.equal(savedAdditionalData.stageCap3, 60);

  const reopenedForm = hydrateAdditionalData(savedAdditionalData);
  assert.equal(reopenedForm.ad_stageName1, "Prospecção");
  assert.equal(reopenedForm.ad_stageName2, "Qualificação");
  assert.equal(reopenedForm.ad_stageName3, "Entrega");
});