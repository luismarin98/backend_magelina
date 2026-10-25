import { randomInt } from 'node:crypto';
import { workflowError } from '../modules/workflow/rules.js';

export type GameKind = 'trivia' | 'ppt' | 'adivina';
export type TriviaTopic = 'mixta' | 'musica' | 'general';
export interface Question { text: string; options: string[]; answer: number; topic: Exclude<TriviaTopic, 'mixta'> }
const music: [string, string, string, string, string][] = [
  ['¿Cuántas líneas tiene un pentagrama?', 'Cinco', 'Cuatro', 'Seis', 'Siete'],
  ['¿Qué indica el tempo de una pieza?', 'Su velocidad', 'Su volumen', 'Su tonalidad', 'Su duración total'],
  ['¿Cuál de estos instrumentos tiene teclas?', 'Piano', 'Violín', 'Trompeta', 'Flauta'],
  ['¿Qué instrumento suele marcar el ritmo en una banda de rock?', 'Batería', 'Arpa', 'Oboe', 'Violín'],
  ['¿Cuál de estos instrumentos es de cuerda?', 'Guitarra', 'Clarinete', 'Trombón', 'Platillos'],
  ['¿Qué mide la abreviatura BPM?', 'Pulsos por minuto', 'Notas por compás', 'Volumen máximo', 'Número de instrumentos'],
  ['¿Qué significa cantar a capela?', 'Cantar sin acompañamiento instrumental', 'Cantar muy rápido', 'Cantar en voz baja', 'Cantar en otro idioma'],
  ['¿Cuál de estas es una nota musical?', 'Fa', 'Ta', 'Pa', 'Va'],
];
const general: [string, string, string, string, string][] = [
  ['¿Qué planeta está más cerca del Sol?', 'Mercurio', 'Venus', 'Marte', 'Júpiter'],
  ['¿Cuántos lados tiene un hexágono?', 'Seis', 'Cinco', 'Siete', 'Ocho'],
  ['¿Qué sustancia representa H₂O?', 'Agua', 'Oxígeno', 'Sal', 'Hierro'],
  ['¿Cuántos días tiene un año bisiesto?', '366', '365', '364', '367'],
  ['¿Qué órgano bombea la sangre?', 'Corazón', 'Pulmón', 'Hígado', 'Riñón'],
  ['¿Cuántos minutos tiene una hora?', '60', '100', '30', '90'],
  ['¿Cuál de estos animales es un mamífero?', 'Delfín', 'Tiburón', 'Pulpo', 'Sardina'],
  ['¿Cuántos lados tiene un triángulo?', 'Tres', 'Cuatro', 'Cinco', 'Seis'],
];
const bank: Question[] = [...music.map(([text, ...options]) => ({ text, options, answer: 0, topic: 'musica' as const })), ...general.map(([text, ...options]) => ({ text, options, answer: 0, topic: 'general' as const }))];
interface Base { finished: boolean; feedback: string }
export type Game =
  | (Base & { kind: 'trivia'; questions: Question[]; round: number; score: number })
  | (Base & { kind: 'ppt'; round: number; score: number; botScore: number })
  | (Base & { kind: 'adivina'; answer: number; guesses: number[] });
export type Random = (maximum: number) => number;
function shuffled<T>(values: T[], random: Random): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) { const other = random(index + 1); [copy[index], copy[other]] = [copy[other]!, copy[index]!]; }
  return copy;
}
export function newGame(kind: GameKind, topic: TriviaTopic = 'mixta', random: Random = randomInt): Game {
  if (kind === 'ppt') return { kind, round: 0, score: 0, botScore: 0, finished: false, feedback: '' };
  if (kind === 'adivina') return { kind, answer: random(10) + 1, guesses: [], finished: false, feedback: '' };
  if (kind !== 'trivia' || !['mixta', 'musica', 'general'].includes(topic)) throw workflowError(400, 'Juego o tema no válido.');
  const questions = shuffled(bank.filter(question => topic === 'mixta' || question.topic === topic), random).slice(0, 5).map(question => {
    const options = shuffled(question.options, random);
    return { ...question, options, answer: options.indexOf(question.options[question.answer]!) };
  });
  return { kind, questions, round: 0, score: 0, finished: false, feedback: '' };
}
export function playGame(game: Game, action: string, random: Random = randomInt): Game {
  if (game.finished) throw workflowError(409, 'La partida ya terminó. Inicia otra con /jugar.');
  if (action === 'salir') return { ...game, finished: true, feedback: 'Has terminado esta partida.' };
  if (!/^(?:[0-9]|10)$/.test(action)) throw workflowError(400, 'Respuesta no válida.');
  const choice = Number(action);
  if (game.kind === 'trivia') {
    const question = game.questions[game.round]!;
    if (choice >= question.options.length) throw workflowError(400, 'Selecciona una respuesta de la pregunta actual.');
    const correct = choice === question.answer;
    return { ...game, round: game.round + 1, score: game.score + Number(correct), finished: game.round + 1 === game.questions.length, feedback: correct ? '¡Correcto!' : `La respuesta era: ${question.options[question.answer]}.` };
  }
  if (game.kind === 'ppt') {
    if (choice > 2) throw workflowError(400, 'Elige piedra, papel o tijera.');
    const bot = random(3), labels = ['piedra', 'papel', 'tijera'];
    const outcome = (choice - bot + 3) % 3;
    return { ...game, round: game.round + 1, score: game.score + Number(outcome === 1), botScore: game.botScore + Number(outcome === 2), finished: game.round + 1 === 3,
      feedback: `Elegiste ${labels[choice]}; Magelina eligió ${labels[bot]}. ${outcome === 0 ? 'Empate.' : outcome === 1 ? '¡Ganaste la ronda!' : 'Magelina ganó la ronda.'}` };
  }
  if (choice < 1 || choice > 10 || game.guesses.includes(choice)) throw workflowError(400, 'Elige un número del 1 al 10 que todavía no hayas probado.');
  const guesses = [...game.guesses, choice], won = choice === game.answer, finished = won || guesses.length === 3;
  return { ...game, guesses, finished, feedback: won ? `¡Acertaste! Era el ${game.answer}.` : finished ? `Se acabaron los intentos. El número era ${game.answer}.` : `Mi número es ${choice < game.answer ? 'mayor' : 'menor'} que ${choice}.` };
}
