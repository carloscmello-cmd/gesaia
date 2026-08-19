import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import type { PendingInvitation } from "@workspace/api-client-react";
import { getListPendingInvitationsQueryKey } from "@workspace/api-client-react";
import UsersPage from "./UsersPage.tsx";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
  });
  const globals = globalThis as Record<string, unknown>;
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "Event",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globals, key)]));
  const setGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globals, key, {
      configurable: true,
      writable: true,
      value,
    });
  };

  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("Node", dom.window.Node);
  setGlobal("Element", dom.window.Element);
  setGlobal("Event", dom.window.Event);
  setGlobal("MouseEvent", dom.window.MouseEvent);
  setGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number);
  setGlobal("cancelAnimationFrame", clearTimeout);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  return {
    rootElement: dom.window.document.getElementById("root") as HTMLDivElement,
    cleanup: () => {
      for (const key of keys) {
        const original = originals.get(key);
        if (original) Object.defineProperty(globals, key, original);
        else delete globals[key];
      }
      dom.window.close();
    },
  };
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await flush();
      });
    }
  }
  throw lastError;
}

test("resend replaces the pending invitation cache entry and refreshes Último envio", async () => {
  const { rootElement, cleanup } = installDom();
  const originalFetch = globalThis.fetch;
  const originalInvitation: PendingInvitation = {
    id: "invitation-original",
    email: "consultor@example.com",
    status: "pending",
    createdAt: "2026-08-18T10:00:00.000Z",
  };
  const resentInvitation: PendingInvitation = {
    id: "invitation-resent",
    email: originalInvitation.email,
    status: "pending",
    createdAt: "2026-08-19T15:30:00.000Z",
  };
  let invitationListRequests = 0;
  let resendRequests = 0;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/users/me") {
      return Promise.resolve(jsonResponse({
        id: 1,
        name: "Administrador",
        role: "admin",
        email: "admin@example.com",
        createdAt: "2026-01-01T00:00:00.000Z",
      }));
    }
    if (url === "/api/users") {
      return Promise.resolve(jsonResponse([]));
    }
    if (url === "/api/users/invitations" && init?.method === "GET") {
      invitationListRequests += 1;
      if (invitationListRequests === 1) return Promise.resolve(jsonResponse([originalInvitation]));
      return new Promise<Response>(() => {});
    }
    if (url === `/api/users/invitations/${originalInvitation.id}/resend` && init?.method === "POST") {
      resendRequests += 1;
      return Promise.resolve(jsonResponse(resentInvitation));
    }

    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  }) as typeof fetch;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const root = createRoot(rootElement);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(UsersPage),
        ),
      );
      await flush();
    });

    await waitFor(() => {
      assert.match(rootElement.textContent ?? "", /consultor@example\.com/);
      assert.equal(rootElement.querySelector('[title="Reenviar convite"]')?.getAttribute("disabled"), null);
    });

    const originalTimestamp = new Date(originalInvitation.createdAt).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const resentTimestamp = new Date(resentInvitation.createdAt).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    assert.match(rootElement.textContent ?? "", new RegExp(`Último envio:\\s*${originalTimestamp}`));

    await act(async () => {
      rootElement.querySelector<HTMLButtonElement>('[title="Reenviar convite"]')?.click();
      await flush();
    });

    await waitFor(() => {
      assert.equal(resendRequests, 1);
      assert.deepEqual(
        queryClient.getQueryData(getListPendingInvitationsQueryKey()),
        [resentInvitation],
        "the resend response should replace the original invitation in the client cache",
      );
      assert.match(rootElement.textContent ?? "", new RegExp(`Último envio:\\s*${resentTimestamp}`));
      assert.doesNotMatch(rootElement.textContent ?? "", new RegExp(`Último envio:\\s*${originalTimestamp}`));
    });
    assert.equal(invitationListRequests, 2, "the mutation should leave the invalidation refetch pending");
  } finally {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    globalThis.fetch = originalFetch;
    cleanup();
  }
});