export class LoadingScreen {

  constructor() {

    document.body.insertAdjacentHTML(

      'beforeend',

      `
      <div id="loading-screen">

        <div id="loading-content">

          <div id="loading-logo">
            PERSONA
          </div>

          <div id="loading-subtitle">
            AI AVATAR SYSTEM
          </div>

          <div id="loading-bar-wrapper">

            <div id="loading-bar-glow"></div>

            <div id="loading-bar"></div>

          </div>

          <div id="loading-text">
            Initializing...
          </div>

        </div>

      </div>
      `
    );

    this.loadingBar =
      document.getElementById(
        'loading-bar'
      );

    this.loadingText =
      document.getElementById(
        'loading-text'
      );

    this.loadingScreen =
      document.getElementById(
        'loading-screen'
      );

  }

  update(
    progress,
    text
  ) {

    this.loadingBar.style.width =
      `${progress}%`;

    if (text) {

      this.loadingText.innerText =
        text;

    }

  }

  complete() {

    this.update(
      100,
      'Avatar Ready'
    );

    setTimeout(() => {

      this.loadingScreen
        .classList.add(
          'hidden'
        );

    }, 500);

    setTimeout(() => {

      this.loadingScreen.remove();

    }, 1800);

  }

}