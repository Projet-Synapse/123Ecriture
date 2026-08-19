//////////////////////////////////////////////////////////////////////////
//                           🤖 Introduction.md                                 //
//////////////////////////////////////////////////////////////////////////

// INTRODUCTION
// 1. 🎯 Vision et Objectifs
// 2. 📶 Explication de la plateforme/application
// 3. 🛠️ Architecture générale
// 4. ⛓️ Conventions du code
// 5. 👍 Checklist de qualité

// 🗞️ INTRODUCTION
Obsidian était bien mieux que ce que j'utilisais au départ: Samsung Notes et m'a permi d'ajouter des propriétés à mes fichiers. Cependant, avec le temps, malgré tous les plugins qu'Obsidian proposait, cela a fini par ne PLUS correspondre à mes besoins. En effet, je ne souhaite plus subir une interface... Et ainsi avoir la possibilité de créer une application à ma véritable image.

// 1. 🎯 Vision et objectifs
Je voudrais une application comme Obsidian... Mais en mieux, avec beaucoup plus de champ des possibles.

// 2. 📶 Explication de la plateforme/application
Cette application/plateforme a pour but d'être liée à mes autres applications à l'avenir. Elle fait partie de tout un ensemble d'applications qui contribueront à mon futur grand et ambitieux projet: Le '🧠 Projet Synapse'. Ce fameux projet consiste à réimaginer l'expérience des utilisateurs sur l'interface numérique en donnant une personnalisation, une agentivité et une fluidité jamais vue sur n'importes quelles activités.
Cette plateforme/application en particulier a plusieurs particularités ambitieuses que je souhaiterais ajouter:
- Interface TRES personnalisable (par n'importe quel individu, pour qu'elle devienne à leur image individuelle). C'est-à-dire, le choix pour la couleur de tout, la réorganisation des boutons...)

// 3. 🛠️ Architecture générale
- Interface très flexible visuellement (puisque personnalisable)
- Format avant tout en mdx
- Les fichiers sont locals, bien que la synchronisation fonctionne par compte
- Application multiplateforme (PC, Mac, Linux, Android, iOS, web...)
- Pleins d'outils disponibles pour maximiser la productivité et l'efficacité:
-> To do lists
-> Calendrier
-> Graphiques
-> Canvas
-> Escalidraws
-> Beaucoup d'automatisation
etc...

// 4. ⛓️ Bonnes pratiques du code
- Conventions de l'apparence des fichiers:
Idéalement, afin de se repérer plus facilement, une bonne organisation et présentation de chaques fiches est fortement recommandée (titre, sommaire, chapitrages...).
- Respecter les conventions d'ESLint dans le fichier de configuration:
Cela est afin d'éviter d'avoir du code mort et des erreurs imperçeptibles dans le code. Il sera d'ailleurs empêché de compiler s'il y a des erreurs dans le code.
- Poser des questions:
N'hésite pas à me faire des questionnaires n'importe quand. Cela permettra d'éviter les malentendus, d'affiner notre travail ensemble et d'avancer de façon plus efficace.
- Tester !
Je t'incite à souvent tester par toi-même l'application comme tu le peux. Car par principe, la modification du code ne doit pas en casser quelque chose silencieusement. Cela est impératif si cela touche les fonctionnalités les plus essentielles pour la performance de l'appli/plateforme. Notamment celles-ci:
-> La stabilité des interfaces en général, quel que soit la plateforme (Android, iOS, Windows, Linux, Mac...)
-> La connexion au compte
-> La sauvegarde et la gestion générale des données
- La règle impérative avant chaque release:
Si tu ajoutes par exemple des boutons ou de nouveaux composants, je souhaiterais que tu tiennes à ce qu'ils soient fonctionnels autant que possible. Je considère qu'ils sont fonctionnels minimum avec ces deux caractéristiques:
- On peut cliquer dessus
- Ils produisent ce qu'ils sont censés faire
Cela m'évitera à avoir à te demander systématiquement de les améliorer encore et encore à chaque session