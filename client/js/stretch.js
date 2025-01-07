/*
 * Tilemap Town
 *
 * Copyright (C) 2017-2018 NovaSquirrel
 *
 * This program is free software: you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

let cascadeX = 32;
let cascadeY = 64;

// web components
customElements.define(
  "widget-window",
  class extends HTMLElement {
    constructor() {
      super();
      let template = document.getElementById("widget-window-template");
      let templateContent = template.content;

      let self = this;

      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(templateContent.cloneNode(true));

      var container = shadowRoot.querySelector('#container');
      var handle = shadowRoot.querySelector('#draghandle');

      container.style.left = cascadeX + "px";
      container.style.top = cascadeY + "px";

      cascadeX += 16;
      cascadeY += 8;

      var dx = 0;
      var dy = 0;

      handle.onmousedown = function(event) {
        dx = event.clientX - container.offsetLeft;
        dy = event.clientY - container.offsetTop;

        document.onmousemove = function(event) {
          container.style.left = Math.max(16, event.clientX - dx) + "px";
          container.style.top = Math.max(32, event.clientY - dy) + "px";
        }

        document.onmouseup = function (event) {
          document.onmousemove = null;
          document.onmouseup = null;
        }
      }

      var minimize = shadowRoot.querySelector('#minimize');
      minimize.onmouseup = function(event) {
        self.style.display = "none";
        if (self.id === 'selectionInfo') {
          MouseActive = false;
          MouseDown = false;
          NeedMapRedraw = true;
        }
      }
    }
  }
);

customElements.define(
  "widget-contextmenu",
  class extends HTMLElement {
    constructor() {
      super();
      let template = document.getElementById("widget-contextmenu-template");
      let templateContent = template.content;

      let self = this;

      const shadowRoot = this.attachShadow({ mode: "open" });
      shadowRoot.appendChild(templateContent.cloneNode(true));

      var container = shadowRoot.querySelector('#container');

      container.onmouseleave = function(event) {
        self.style.display = "none";
      }

      container.onmouseup = function(event) {
        if ( event.button == 0 ) {
          self.style.display = "none";
        }
      }
    }
  }
);
