export async function runRecoveryProbe({ send, provider, model, text }) {
  if (typeof send !== "function") throw new TypeError("recovery probe requires a send function");
  if (typeof provider !== "string" || provider.trim() === ""
    || typeof model !== "string" || model.trim() === "") {
    return { modelSelected: false, selectionFailure: "missing-fixture-model" };
  }

  let modelSelection;
  try {
    modelSelection = await send({
      id: "c30m",
      method: "setModel",
      params: { provider, model },
    });
  } catch (modelSelectionError) {
    return {
      modelSelected: false,
      selectionFailure: "set-model-transport-error",
      modelSelectionError,
    };
  }

  const modelSelected = !modelSelection?.error
    && modelSelection?.result?.provider === provider
    && modelSelection?.result?.model === model;
  if (!modelSelected) {
    return { modelSelected: false, selectionFailure: "set-model-error", modelSelection };
  }

  try {
    const promptResponse = await send({
      id: "c30r",
      method: "prompt",
      params: { text },
    });
    return { modelSelected: true, modelSelection, promptResponse };
  } catch (promptError) {
    return { modelSelected: true, modelSelection, promptError };
  }
}
