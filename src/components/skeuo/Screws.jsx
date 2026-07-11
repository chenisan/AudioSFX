// Four chrome corner screws for a raised bezel plate (parent must be
// position:relative). Sells the "physical plate bolted onto the amp" look.
export default function Screws() {
  return (
    <>
      <span className="amp-screw absolute top-1.5 left-1.5" />
      <span className="amp-screw absolute top-1.5 right-1.5" />
      <span className="amp-screw absolute bottom-1.5 left-1.5" />
      <span className="amp-screw absolute bottom-1.5 right-1.5" />
    </>
  )
}
