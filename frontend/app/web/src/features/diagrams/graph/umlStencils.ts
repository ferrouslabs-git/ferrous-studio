// XML stencils for the shapes maxGraph has no built-in for: the stick-figure
// actor, the folded-corner note and the sequence lifeline. Coordinates are in
// each shape's own w/h units and scale with the cell.
export const STENCILS_XML = `<shapes>
  <shape name="uml-actor" aspect="fixed" w="40" h="70" strokewidth="inherit">
    <background>
      <ellipse x="12" y="0" w="16" h="16"/>
    </background>
    <foreground>
      <fillstroke/>
      <path>
        <move x="20" y="16"/><line x="20" y="42"/>
        <move x="2" y="24"/><line x="38" y="24"/>
        <move x="20" y="42"/><line x="4" y="70"/>
        <move x="20" y="42"/><line x="36" y="70"/>
      </path>
      <stroke/>
    </foreground>
  </shape>
  <shape name="uml-note" aspect="variable" w="100" h="60" strokewidth="inherit">
    <background>
      <path>
        <move x="0" y="0"/><line x="82" y="0"/><line x="100" y="18"/><line x="100" y="60"/><line x="0" y="60"/><close/>
      </path>
    </background>
    <foreground>
      <fillstroke/>
      <path>
        <move x="82" y="0"/><line x="82" y="18"/><line x="100" y="18"/>
      </path>
      <stroke/>
    </foreground>
  </shape>
  <shape name="uml-lifeline" aspect="variable" w="100" h="200" strokewidth="inherit">
    <background>
      <rect x="0" y="0" w="100" h="40"/>
    </background>
    <foreground>
      <fillstroke/>
      <dashed dashed="1"/>
      <path>
        <move x="50" y="40"/><line x="50" y="200"/>
      </path>
      <stroke/>
    </foreground>
  </shape>
</shapes>`;
