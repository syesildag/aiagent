#!/usr/bin/env node
/**
 * Example usage of insertEmbeddings script
 * 
 * Usage:
 *   npm run build && node dist/scripts/insertEmbeddingsExample.js
 */

import insertEmbeddings, { DocumentInput } from '../scripts/insertEmbeddings';
import Logger from '../utils/logger';

async function runExample() {
  // Sample documents to insert
  const documents: DocumentInput[] = [
    {
      name: "Passerelle entrante - Principe de fonctionnement",
      content: `
1) Resalys interroge le catalogue (service getProducts) pour établir la liste des établissements exposés par le fournisseur.
2) Vous associez manuellement un établissement de Resalys avec un établissement de cette liste.
3) Resalys interroge le catalogue une nouvelle fois pour créer dans Resalys chacun des types d'hébergement exposés par le fournisseur.
4) Vous validez les informations saisies par le camping.
5) Resalys interroge le stock/prix pour incorporer un stock (quantité jour par jour) et un prix (prix jour par jour ou par séjour) pour chacun des types d'hébergement
6) Resalys expose les hébergements via le site web du revendeur.
7) Au moment de la vente à l'internaute, Resalys interroge le PMS pour vérifier que le séjour est toujours disponible.
8) Une fois la vente effectuée, Resalys envoie le dossier de réservation au PMS.`,
      type: "resalys-documentation"
    },
    {
      name: "Passerelle entrante - Prérequis à la mise en place", 
      content: `
<ol>
<li>Resalys interroge le catalogue (service getProducts) pour établir la liste des établissements exposés par le fournisseur.</li>
<li>Vous associez manuellement un établissement de Resalys avec un établissement de cette liste.</li>
<li>Resalys interroge le catalogue une nouvelle fois pour créer dans Resalys chacun des types d'hébergement exposés par le fournisseur.</li>
<li>Vous validez les informations saisies par le camping.</li>
<li>Resalys interroge le stock/prix pour incorporer un stock (quantité jour par jour) et un prix (prix jour par jour ou par séjour) pour chacun des types d'hébergement</li>
<li>Resalys expose les hébergements via le site web du revendeur.</li>
<li>Au moment de la vente à l'internaute, Resalys interroge le PMS pour vérifier que le séjour est toujours disponible.</li>
<li>une fois la vente effectuée, Resalys envoie le dossier de réservation au PMS.</li>
</ol>`,
      type: "resalys-documentation"
    },
    {
      name: "Passerelle entrante - Activation",
      content: `
Chemin Administration > Configuration > Modules
Il est nécessaire d'activer le module "passerelle entrante" afin de pouvoir accéder à l'ensemble des informations liés au paramétrage de la passerelle entrante standard. 
Chemin Administration > Configuration > Onglet Passerelles BtoB - Bloc Activer la passerelle entranteRenseignez ici l'ensemble des informations liées à l'activation de la passerelle entrante 
Ces paramètres sont partagés avec l'ensemble des passerelles entrantes dont Webcamp. 
Voir la section suivante du manuel utilisateur : Configuration des passerelles entrantes
Les sous statuts ont été définis en amont via Paramétrage > Dossiers > Sous statut de réservation : 
Sous statuts de dossier ferme / option / délogé : 
* non envoyé (déclenche l'envoi de la réservation) : 3 - Not synchronised
* envoyé (après envoi de la réservation) : 4 - Synchronised
* erreur technique (non envoi de la réservation suite à une erreur technique) : 5 - Technical error
* erreur fonctionnelle (non envoi de la réservation suite à une erreur fonctionnelle) : 6 - Settings error
Sous statuts de dossier annulé / option expirée annulée : 
* non envoyé (déclenche l'envoi de la réservation) : 7 - Not synchronised
* envoyé (après envoi de la réservation) : 8 - Synchronised
* erreur technique (non envoi de la réservation suite à une erreur technique) : 9 - Technical error
* erreur fonctionnelle (non envoi de la réservation suite à une erreur fonctionnelle) : 10 - Settings error
      `,
      type: "resalys-documentation"
    }
  ];

  Logger.info('Starting embedding insertion example...');

  try {
    const results = await insertEmbeddings(documents);

    Logger.info(`✅ Successfully inserted ${results.length} documents`);
    
    // Display summary
    console.log('\n📄 Inserted Documents:');
    results.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.getName()}`);
      console.log(`   ID: ${doc.getId()}`);
      console.log(`   Type: ${doc.getTypeId()}`);
      console.log(`   Content length: ${doc.getContent().length} chars`);
      console.log(`   Has embedding: ${doc.getEmbedding() ? 'Yes' : 'No'}`);
      console.log('');
    });

  } catch (error) {
    Logger.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runExample().catch(error => {
    console.error('Example execution failed:', error);
    process.exit(1);
  });
}

export default runExample;