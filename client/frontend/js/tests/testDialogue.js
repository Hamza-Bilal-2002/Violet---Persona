export function runTestDialogue(
  dialogueManager
) {

  setTimeout(() => {

    dialogueManager.enqueue({

      text:
        'Hello.',

      emotion:
        'happy',

      animation:
        'waving',

      priority: 1,

    });

  }, 1000);

  setTimeout(() => {

    dialogueManager.enqueue({

      text:
        'I can speak.',

      emotion:
        'relaxed',

      animation:
        'talking',

      priority: 1,

    });

  }, 2500);

  setTimeout(() => {

    dialogueManager.enqueue({

      text:
        'I can speak with emotions.',

      emotion:
        'relaxed',

      animation:
        'talking',

      priority: 1,

    });

  }, 4500);


  // ======================
  // INTERRUPT TEST
  // ======================

  setTimeout(() => {

    dialogueManager.enqueue({

      text:
        'Urgent interruption message.',

      emotion:
        'angry',

      animation:
        'reacting',

      priority: 100,

      interrupt: true,

    });

  }, 9000);

}
