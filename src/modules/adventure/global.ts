import { Router } from 'express';
import { AdventureCharacter } from '../../database/models/Adventure.js';
import { requireUser } from '../../auth/routes.js';
import { object, version } from '../common/input.js';
import { characterAlias } from './routes.js';
import { workflowError } from '../workflow/rules.js';
import { hasCode } from '../../types/errors.js';

function profession(value: unknown): 'hunter' | 'merchant' {
  if (value !== 'hunter' && value !== 'merchant') throw workflowError(400, 'Elige cazador o comerciante.');
  return value;
}
const dto = (character: any) => character ? ({ alias: character.alias, profession: character.profession ?? null, level: character.level, rank: character.rank, coins: character.coins, experience: character.experience, version: character.version }) : null;

export function globalAdventureRoutes() {
  const router = Router();
  router.use(requireUser);
  router.get('/', async (req, res) => {
    const character = await AdventureCharacter.findOne({ userId: req.session.user!.id }).lean();
    res.json({ character: dto(character) });
  });
  router.post('/start', async (req, res) => {
    const input = object(req.body, ['alias', 'profession']);
    const fields = { alias: characterAlias(input.alias), profession: profession(input.profession) };
    const userId = req.session.user!.id;
    let character = await AdventureCharacter.findOne({ userId });
    if (!character) {
      try { character = await AdventureCharacter.create({ userId, ...fields }); }
      catch (error) {
        if (!hasCode(error, 11000)) throw error;
        character = await AdventureCharacter.findOne({ userId });
      }
    }
    if (!character) throw workflowError(503, 'No se pudo confirmar tu personaje. Inténtalo de nuevo.');
    res.json({ character: dto(character) });
  });
  router.patch('/character', async (req, res) => {
    const input = object(req.body, ['alias', 'profession', 'version']);
    const character = await AdventureCharacter.findOneAndUpdate({ userId: req.session.user!.id, version: version(input.version) }, {
      $set: { alias: characterAlias(input.alias), profession: profession(input.profession) }, $inc: { version: 1 },
    }, { new: true, runValidators: true });
    if (!character) throw workflowError(409, 'Tu personaje cambió o todavía no existe. Revisa sus datos antes de guardar.');
    res.json({ character: dto(character) });
  });
  return router;
}
