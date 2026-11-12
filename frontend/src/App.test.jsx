import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

const resultadoNormal = {
  sucesso: true,
  matriz: [[25, 28, 30], [27, 29, 31], [26, 28, 78]],
  medias: [27.67, 29, 44.67],
  maiorTemperatura: 78,
  localizacao: { rack: 2, sensor: 2 },
  alerta: true,
  mensagem: "ALERTA: Ponto Crítico de Sobreaquecimento Detectado",
};

function respostaJson(dados, ok = true) {
  return { ok, json: async () => dados };
}

const HISTORY_URL = "/api/historico?limit=20";
const historicoVazio = {
  itens: [],
  persistencia: { tipo: "arquivo local", persistente: true, aviso: null },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url) =>
    url === HISTORY_URL ? Promise.resolve(respostaJson(historicoVazio)) : Promise.resolve(respostaJson({}))
  ));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Rack Monitor - interface", () => {
  it("renderiza os três racks e os nove sensores com valores iniciais", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Monitoramento de temperatura" })).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(9);
    expect(screen.getByText("9/9")).toBeInTheDocument();
    expect(screen.getByText("Rack 1")).toBeInTheDocument();
    expect(screen.getByText("Rack 2")).toBeInTheDocument();
    expect(screen.getByText("Rack 3")).toBeInTheDocument();
  });

  it("rejeita temperaturas fora da faixa antes de chamar a API", () => {
    render(<App />);
    const sensores = screen.getAllByRole("spinbutton");
    fireEvent.change(sensores[0], { target: { value: "9" } });
    fireEvent.submit(sensores[0].closest("form"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Informe valores numéricos entre 10 e 90 °C em todos os sensores."
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("restaura os nove campos para os valores iniciais", async () => {
    const user = userEvent.setup();
    render(<App />);
    const primeiroSensor = screen.getAllByRole("spinbutton")[0];

    await user.clear(primeiroSensor);
    await user.type(primeiroSensor, "44");
    await user.click(screen.getByRole("button", { name: /Restaurar valores/i }));

    expect(primeiroSensor).toHaveValue(25);
    expect(screen.getByText("9/9")).toBeInTheDocument();
  });

  it("envia as temperaturas e apresenta o relatório de superaquecimento", async () => {
    const user = userEvent.setup();
    const registro = { ...resultadoNormal, id: "registro-1", registradoEm: "2026-11-12T12:00:00.000Z" };
    fetch.mockImplementation((url) => url === HISTORY_URL
      ? Promise.resolve(respostaJson(historicoVazio))
      : Promise.resolve(respostaJson({ ...resultadoNormal, historico: registro, persistencia: historicoVazio.persistencia }))
    );
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Analisar temperaturas/i }));

    expect(await screen.findByRole("heading", { name: "Relatório térmico" })).toBeInTheDocument();
    expect(screen.getByText("Rack 3, Sensor 3", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Atenção: superaquecimento")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/monitoramento", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
  });

  it("exibe uma mensagem quando a API não está disponível", async () => {
    const user = userEvent.setup();
    fetch.mockImplementation((url) => url === HISTORY_URL
      ? Promise.resolve(respostaJson(historicoVazio))
      : Promise.reject(new Error("Servidor indisponível"))
    );
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Analisar temperaturas/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Servidor indisponível");
    });
  });
});


  it("carrega o histórico e permite reabrir um relatório anterior", async () => {
    const user = userEvent.setup();
    const registro = { ...resultadoNormal, id: "historico-1", registradoEm: "2026-11-12T12:00:00.000Z" };
    fetch.mockImplementation((url) => url === HISTORY_URL
      ? Promise.resolve(respostaJson({ itens: [registro], persistencia: historicoVazio.persistencia }))
      : Promise.resolve(respostaJson({}))
    );
    render(<App />);
    expect(await screen.findByText(/Máxima: 78\.0 °C/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ver relatório/i }));
    expect(screen.getByRole("heading", { name: "Relatório térmico" })).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(25);
  });
