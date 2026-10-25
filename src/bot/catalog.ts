import { commandDefinitions } from './commands/registry.js';

interface Option {
  type: number; name: string; description: string; required?: boolean;
  choices?: { name: string; value: string | number }[]; options?: Option[];
  min_value?: number; max_value?: number; min_length?: number; max_length?: number;
}
const optionTypes: Record<number, string> = { 3: 'Texto', 4: 'Entero', 5: 'Sí / No', 6: 'Usuario', 7: 'Canal', 8: 'Rol', 9: 'Mención', 10: 'Número', 11: 'Archivo' };
function requirements(name: string, subcommand: string): string[] {
  if (name === 'jugar') return ['Ser miembro del servidor y tener acceso al canal y permiso para usar comandos de aplicaciones.', 'Partida personal; botones válidos durante cinco minutos sin jugar. Diez segundos entre partidas nuevas.', 'Respeta el mantenimiento y los servidores suspendidos. Los resultados no se guardan.'];
  if (name === 'Crear solicitud') return ['Módulo Solicitudes habilitado.', 'Ver el canal y leer el historial del mensaje de origen.'];
  if (name === 'musica') return [
    `Permiso interno: ${['youtube', 'agregar'].includes(subcommand) ? 'music.request' : ['buscar', 'cola'].includes(subcommand) ? 'music.read' : 'music.manage'}.`,
    subcommand === 'desconectar' ? 'Permite desconectar aunque el módulo Música esté deshabilitado.' : 'Módulo Música habilitado.',
    ...(subcommand === 'buscar' ? ['Para añadir una canción desde los resultados necesitas music.request.'] : []),
    ...(['buscar', 'cola'].includes(subcommand) ? [] : ['Para actuar en un canal necesitas acceso a él. Los usuarios sin administración deben estar en el mismo canal de voz.']),
    ...(subcommand === 'conectar' ? ['Entra primero a un canal de voz. Magelina necesita Ver canal, Conectar y Hablar.'] : []),
    ...(subcommand === 'youtube' ? ['Fuente experimental de YouTube habilitada en el backend. Video público de hasta 30 minutos.'] : []),
  ];
  const capabilities: Record<string, string> = { solicitudes: 'workflow.read', solicitud: 'workflow.manage', conocimiento: 'knowledge.read', proyectos: 'projects.read', colaboracion: 'collaboration.read', automatizaciones: 'automations.read' };
  return capabilities[subcommand] ? [`Permiso interno: ${capabilities[subcommand]}.`, 'Módulo correspondiente habilitado.'] : ['Disponible en servidores. El dashboard comprueba el acceso a cada sección.'];
}

/** Derived from the same definitions used for publication; no Discord writes or secrets. */
export function commandCatalog() {
  const entries: { id: string; group: string; name: string; description: string; kind: 'slash' | 'message'; usage: string; requirements: string[]; parameters: { name: string; description: string; type: string; required: boolean; choices: { name: string; value: string | number }[]; min?: number; max?: number; minLength?: number; maxLength?: number }[] }[] = [];
  for (const definition of commandDefinitions) {
    const visit = (options: Option[], path: string[], description: string) => {
      const subcommands = options.filter(option => option.type === 1 || option.type === 2);
      if (subcommands.length) {
        for (const option of subcommands) visit(option.options ?? [], [...path, option.name], option.description);
        return;
      }
      const name = path.join(' '), kind = definition.type === 3 ? 'message' : 'slash';
      entries.push({ id: `${definition.type}:${name}`, group: definition.name, name: kind === 'slash' ? `/${name}` : name,
        description: description || 'Convierte un mensaje en una solicitud para tu comunidad.', kind,
        usage: kind === 'message' ? 'En un mensaje: clic derecho → Aplicaciones → Crear solicitud' : `/${name}${options.map(option => ` ${option.required ? `<${option.name}>` : `[${option.name}]`}`).join('')}`,
        requirements: requirements(definition.name, path.at(-1)!),
        parameters: options.map(option => ({ name: option.name, description: option.description, type: optionTypes[option.type] ?? 'Opción', required: option.required ?? false, choices: option.choices ?? [], min: option.min_value, max: option.max_value, minLength: option.min_length, maxLength: option.max_length })),
      });
    };
    visit('options' in definition ? definition.options ?? [] : [], [definition.name], 'description' in definition ? definition.description : '');
  }
  return { commands: entries };
}
