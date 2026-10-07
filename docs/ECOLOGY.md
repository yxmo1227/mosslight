# Living ecology in v0.9

Mosslight is an offline, science-inspired illustrated companion, not a calibrated terrarium forecast. Its rates are deliberately accelerated so change is visible. `Amber caps` and `Ivory bells` are fictional visual varieties, not cultivation instructions. User-authored plants never permanently die: adverse conditions produce reversible dormancy, discoloration and contraction. This survival policy is an explicit artistic choice, not a claim about real species.

## What now changes over time

| Environment | Visible result | State boundary |
| --- | --- | --- |
| Suitable moisture, temperature and moderate light | Moss broadens, develops denser tips, and coats nearby houses, stairs, stone and wood | Stored spread and per-object coverage; no new unsupported geometry |
| Established fungi on suitable organic substrate | Nearby new clusters; pins, flush, withering and dormant remnants recur | Persistent colony identity, cyclical fruit appearance, bounded daughter colonies |
| Dryness or sustained excessive light/heat | Golden/yellow foliage, curling and drooping; fern/Fittonia shrink markedly | Reversible stress and reduced visible growth; living roots retained |
| Prolonged saturation | Plant stress and contraction; wood darkens and gains pale fungal fuzz | Moisture-dependent mold and weathering; no disappearing supports |
| Improved care | Gradual greening and resumed foliage growth/fruiting | Stress recovers, not an instant resurrection toggle |

Moss needs an existing planted source to begin coating objects. Exposure uses proximity and attachment, source vitality and spread. The coating is clipped to the object's real artwork—including extended stumps—and retains its original silhouette and support shape. Established mats can remain and respond to environment after their original movable source is removed. Ordinary rooted plants do not spontaneously seed the bottle.

The illustrated moss footprint can reach about 1.82 times its baseline width; object coatings grow from irregular small islands toward broad coverage. This is conspicuous visual colonization, not unlimited new movable moss entities or guaranteed coverage of every surface in every environment.

## Fungal lifecycle and capacity

Established authored fungi can produce at most two nearby daughter clusters. Generated clusters do not reproduce recursively. Global generated capacity is 12; automatic births stop once there are 18 plants, leaving six of the 24 slots for manual placement. Organic candidate positions are checked; an unsuitable side does not prevent trying the other side. Stable identifiers and persisted birth slots make replay deterministic and respect deliberate deletion.

A fungal cycle uses a base 48 simulated days, adjusted by suitability: developing pins, a full flush, fading caps and a rest period. Stress holds colonies near dormancy. These times are gameplay parameters, not measured mushroom lifespan. Authored and generated colonies retain identities while their visible fruit bodies change. Removing an authored fungal source removes its generated family; that is a colony-edit operation, not ecological death. Daughter clusters cannot point to a missing parent or form recursive ancestry.

## One water budget

All quantities are normalized, not milliliters or laboratory soil-water percentages:

`total water = soil moisture + reserve + 0.08 × air humidity + (sum of pond depths − exchange) / 480`

Pond depths remain integer units for stable basin geometry. Optional `exchange` records the consumed fraction of one unit, so tiny time steps do not round evaporation or infiltration away. Empty ponds cannot hold a negative remainder. Pouring, draining and terrain reconciliation preserve that bookkeeping; unavoidable overflow leaves the bottle.

- Pond water wets the shared soil store and contributes to evaporation.
- Closed bottles redistribute water between soil, reserve and air by evaporation/condensation. They do not lose total water just because time passes.
- Open bottles lose vapor through ventilation; visible pond water can diminish and eventually disappear.
- Abundant water may create saturation stress rather than an unconditional growth bonus.
- Spraying adds bounded water and transient leaf wetness. The short sunlight icon remains a gentle positive care interaction; sustained excessive light in the environment settings causes stress.

The model uses a shared soil-water store, not a 3D spatial moisture solver. It does not model exact substrate permeability, transpiration by species, oxygen chemistry or nutrient mass. Pond surfaces can level and water can transfer, but there is no automatic terrain erosion, sediment transport, soil compaction or material decomposition. Objects do not physically displace fluid.

## Wood and persistent layouts

Wood and stumps—including old conditionless objects—join ecological weathering on actual time progression. Dampness accelerates darkening; sustained wet/humid conditions encourage mold, with a simplified oxygen-limitation factor under saturation. Mold can diminish after conditions improve. Weathering never destroys wood, collapses an arrangement or invents nutrients. Blackening is an illustration of aging/decomposition conditions, not a measured percentage of rotten timber.

## Time, saves and computational limits

Online default time is 24× real time multiplied by the selected speed; offline is 1×; pause stops ecology. An advance uses at most 4,096 steps, with ordinary short periods integrating more finely. Huge absences remain computationally bounded; bit-identical results for arbitrary time partitioning are not promised. Multi-year one-shot versus daily comparisons belong in the version's verification record.

Old saves are validated and copied without repositioning or retroactively covering their objects. Missing lifecycle fields initialize on subsequent time advancement. Thus an existing 73-day bottle begins its newly enabled succession from the upgrade, rather than immediately receiving 73 days of invented history. Before the first extended save, compatible old originals receive fixed pre-v0.9 preservation copies; see the user guide.

## Scientific basis versus artistic simplification

- Moss can expand locally through vegetative reproduction and disperse through other propagules; habitat and species matter. [Australian National Botanic Gardens: sexual versus vegetative reproduction](https://www.anbg.gov.au/bryophyte/sexual-vegetative.html).
- Some bryophytes tolerate drying and resume activity; this ability is not universal. The game's guaranteed recovery deliberately exceeds what can be assumed for real foliage. [ANBG: bryophytes in arid areas](https://www.anbg.gov.au/bryophyte/ecology-arid.html).
- Mushrooms are fruit bodies of fungi; mycelium obtains food and fruits when conditions allow. Their life cycle is not permanent accumulation of green plants. [Cornell Small Farms: Mycology 101](https://smallfarms.cornell.edu/resources/mycology-101/).
- Closed terrariums recycle moisture; open ones need different care, and direct sunlight/overwatering can be harmful. [Illinois Extension: bottle terrariums](https://extension.illinois.edu/news-releases/diy-bottle-terrariums-make-great-holiday-gifts).
- Wood-degrading fungi depend on organic substrate, suitable temperature, moisture and oxygen. A single humidity number is not a complete rot model. [US Forest Service: Biodeterioration of wood](https://research.fs.usda.gov/treesearch/62262).

These primary sources guide mechanisms only. No external code, photographs, characters or proprietary assets were copied. The current growth rates, coverage thresholds, normalized water units and guaranteed survival are original product choices and have not been validated against longitudinal experiments.
