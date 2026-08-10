# Spark — step back into your memories

## Inspiration

We've all tried explaining an incredible experience to a friend, only to give up and say, "You just had to be there." We wanted to change that.

We wanted to make memories feel like places you can actually step back into, not just flat folders of photos and videos. Our idea was to reconstruct an event as an interactive 3D environment using Gaussian splatting.

The problem is that creating a good 3D reconstruction normally requires someone to deliberately walk around filming everything from many angles. We wanted to remove that friction, so we built a small autonomous camera rover that can move around an event and continuously capture the footage needed for reconstruction.

## What it does

Spark turns captured footage into a Gaussian-splat reconstruction of a real place or event, then wraps it in a platform where that reconstruction becomes an explorable memory. A memory can contain:

- An explorable 3D reconstruction you can step inside
- Photos and the important moments Spark kept
- Audio recorded during the event
- Paths showing where people or the rover moved
- Highlighted locations and moments pinned inside the 3D space

The platform surfaces all of this across a few connected views:

- **Album** — every finished reconstruction as a Gaussian splat you can walk back into.
- **Map** — every located moment pinned on a real survey map. Moments captured in the same spot **stack into one marker** and split apart as you zoom, so a busy location reads clearly instead of piling pins on top of each other.
- **Trips** — each walk or drive as a selectable route: the path, the moments, and the objects it kept along the way.
- **Capture** — where a new memory begins, live from the rover or the phone.

For our hackathon demo, the goal was to reconstruct the venue itself and turn the hackathon into a memory that can be revisited afterward.

We also built a camera rover that autonomously drives through the environment and gathers imagery instead of requiring someone to manually scan the entire space with a phone.

## How we built it

**The rover.** A camera, motors, steering hardware, and onboard control software let it move through the environment while continuously recording. Alongside the video we collect rover **odometry** — an estimate of the camera's movement through the space — which can seed the reconstruction pipeline and cut down how much work it spends estimating camera poses from scratch.

**Capture.** In addition to the rover, we support phone-side capture (iPhone LiDAR over Wi-Fi, with an ESP32 in the loop), recording per-frame camera transforms, intrinsics, and a GPS fix so a memory lands at its true place on the map.

**Reconstruction.** Captured frames run through a computer-vision pipeline (COLMAP for structure, then Gaussian-splat training) to produce the 3D scene that becomes the foundation of the memory.

**The platform.** A web app (Next.js) presents the reconstructions and the media attached to them — Album, Map, Trips, and Capture — reusing one pipeline and one dataset so every view feels like the same place. A **multi-pass, in-browser object detector** (test-time augmentation with tiled passes and agreement scoring) finds and indexes the objects and moments worth keeping, entirely client-side.

## Challenges we ran into

One of the biggest challenges was combining robotics and 3D reconstruction into a single system within hackathon time constraints.

Gaussian splatting needs useful coverage of the environment, so the rover has to capture enough different viewpoints without simply recording the same surfaces repeatedly. At the same time, autonomous movement introduces steering accuracy, motion blur, changing lighting, and the constant problem of keeping track of the camera's position.

Reconstruction time was another. Traditional camera-pose estimation is computationally expensive, especially with many frames — which motivated us to experiment with using rover odometry as additional information for the pipeline. On the detection side, a single model pass proved noisy and missed small objects, so we moved to a multi-pass approach that steadies the boxes and reports how confidently each object was seen.

## What we learned

We learned how closely robotics and computer vision can complement each other. Information that already exists in the physical system — wheel odometry, the rover's trajectory — can make the 3D reconstruction process more efficient.

We also learned that capturing a memory is more than reconstructing geometry. Combining spatial information with audio, movement, photos, and highlights makes the final result feel much closer to revisiting an experience than simply viewing a 3D model.

## Tracks

**[Main] Summerhacks Track — one moment of human input becomes a shared, growing artifact.**
A single capture — one walk or drive through a place — is transformed into an explorable online memory that anyone can step into. Each new moment, photo, or reconstruction gets pinned spatially and adds to the artifact: the Map and Album grow as more memories land, turning individual captures into one shared, living record of the event rather than isolated files.

**[Sponsor] Best Use of Reve — a distinctive brand and visual identity.**
We used Reve to build Spark's look so it doesn't read as a generic AI frontend: a cohesive "field-notes / journal" aesthetic — cream survey paper, pine ink, brass accents — a friendly blob mascot, an aurora landing scene, and the illustrations and storytelling visuals that carry the product. The identity is consistent across every view (Album, Map, Trips, Capture) so the whole app feels like one designed place.

**[Sponsor] TECHNATION: Data Intelligence Track — surfacing the data the product generates.**
Spark generates rich data as it runs — detected objects, kept moments, movement paths, reconstruction stats, and per-location coverage — and rather than logging it silently, it makes that data explorable. The Map plots located moments and clusters co-located ones; the Album exposes each reconstruction's specs; Trips break a route into its moments and the objects seen along it. The intelligence Spark extracts is something people can actually see and navigate.
