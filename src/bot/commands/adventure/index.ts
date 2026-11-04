import { SlashCommandBuilder } from 'discord.js';
const root = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
export const adventureCommands = [
  root('aventura', 'Gestiona tu aventura y tu personaje')
    .addSubcommand(s => s.setName('iniciar').setDescription('Crea tu personaje, sin reiniciar uno existente')
      .addStringOption(o => o.setName('profesion').setDescription('Tu actividad inicial').setRequired(true).addChoices({ name: 'Cazador', value: 'hunter' }, { name: 'Comerciante', value: 'merchant' }))
      .addStringOption(o => o.setName('alias').setDescription('Nombre de tu personaje').setMinLength(2).setMaxLength(32)))
    .addSubcommand(s => s.setName('unirse').setDescription('Inscribete en el gremio de este servidor'))
    .addSubcommand(s => s.setName('continuar').setDescription('Consulta la etapa pendiente y elige como avanzar'))
    .addSubcommand(s => s.setName('recoger').setDescription('Recoge las recompensas de tu aventura terminada'))
    .addSubcommand(s => s.setName('abandonar').setDescription('Confirma si deseas abandonar tu aventura')),
  root('perfil', 'Consulta los datos publicos de un personaje').addUserOption(o => o.setName('usuario').setDescription('Personaje que quieres consultar')),
  root('inventario', 'Consulta tus objetos y monedas en privado'),
  root('aventuras', 'Consulta y acepta los encargos disponibles en este pais'),
  root('viajar', 'Elige un pais donde ya estas inscrito, o el refugio neutral'),
  root('mercado', 'Consulta el mercado de este servidor y confirma una compra'),
  root('fabricar', 'Elige una receta y confirma su fabricacion').addIntegerOption(o => o.setName('cantidad').setDescription('Unidades que deseas fabricar').setMinValue(1).setMaxValue(100)),
  root('vender', 'Vende objetos propios al mercado del pais donde estas').addIntegerOption(o => o.setName('cantidad').setDescription('Unidades que deseas vender').setMinValue(1).setMaxValue(100)),
  root('ayuda', 'Consulta la ayuda de Magelina').addSubcommand(s => s.setName('juego').setDescription('Como empezar a jugar y usar los comandos de aventura')),
];
