import com.sedmelluq.discord.lavaplayer.player.*;
import com.sedmelluq.discord.lavaplayer.player.event.AudioEventAdapter;
import com.sedmelluq.discord.lavaplayer.tools.FriendlyException;
import com.sedmelluq.discord.lavaplayer.track.*;
import com.sedmelluq.discord.lavaplayer.track.playback.AudioFrame;
import dev.lavalink.youtube.YoutubeAudioSourceManager;
import dev.lavalink.youtube.YoutubeSourceOptions;
import dev.lavalink.youtube.clients.skeleton.Client;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Consume real decoded audio frames without Discord or account credentials. */
public class AudioProbe {
  static void report(String status, long frames, long target, long first, String reasons) {
    System.out.println("MAGELINA_PROBE:{\"status\":\"" + status + "\",\"decodedMs\":" + frames * 20
      + ",\"targetMs\":" + target + ",\"firstAudioMs\":" + first + ",\"reasons\":\"" + reasons + "\",\"discordConnected\":false}");
  }
  static void classify(Throwable error, Set<String> reasons, int depth) {
    if (error == null || depth > 5) return;
    String text = error.toString().toLowerCase(Locale.ROOT);
    if (text.contains("login") || text.contains("sign in") || text.contains("not a bot")) reasons.add("source-auth-required");
    if (text.contains("403")) reasons.add("source-forbidden");
    if (text.contains("429")) reasons.add("source-rate-limited");
    if (text.contains("no supported audio") || text.contains("no formats")) reasons.add("source-format-unavailable");
    if (text.contains("cipher") || text.contains("signature")) reasons.add("cipher-error");
    if (text.contains("sabr")) reasons.add("sabr-error");
    classify(error.getCause(), reasons, depth + 1);
    for (Throwable suppressed : error.getSuppressed()) classify(suppressed, reasons, depth + 1);
  }
  public static void main(String[] args) throws Exception {
    if (args.length != 2 || !args[0].matches("[a-zA-Z0-9_-]{11}")) throw new IllegalArgumentException("VIDEO_ID SECONDS");
    int seconds = Integer.parseInt(args[1]);
    if (seconds < 1 || seconds > 240) throw new IllegalArgumentException("Invalid duration");
    List<Client> clients = new ArrayList<>();
    for (String name : System.getenv().getOrDefault("PROBE_CLIENTS", "Web,MWeb,AndroidVr,TvHtml5Simply,WebEmbedded").split(",")) {
      try { clients.add((Client) Class.forName("dev.lavalink.youtube.clients." + name).getDeclaredConstructor().newInstance()); }
      catch (ClassNotFoundException ignored) { }
    }
    DefaultAudioPlayerManager manager = new DefaultAudioPlayerManager();
    YoutubeSourceOptions options = new YoutubeSourceOptions().setRemoteCipher("http://127.0.0.1:8001", System.getenv("CIPHER_TOKEN"), "Magelina-local-probe");
    options.setRemotePoToken("http://127.0.0.1:8002", System.getenv("POT_TOKEN"));
    manager.registerSourceManager(new YoutubeAudioSourceManager(options, clients.toArray(new Client[0])));
    AudioPlayer player = manager.createPlayer();
    AtomicReference<Throwable> failure = new AtomicReference<>();
    AtomicReference<AudioTrack> track = new AtomicReference<>();
    CountDownLatch loaded = new CountDownLatch(1);
    player.addListener(new AudioEventAdapter() {
      @Override public void onTrackException(AudioPlayer p, AudioTrack t, FriendlyException e) { failure.set(e); }
    });
    long began = System.nanoTime(), frames = 0, first = -1, target = seconds * 1000L;
    try {
      manager.loadItem("https://www.youtube.com/watch?v=" + args[0], new AudioLoadResultHandler() {
        public void trackLoaded(AudioTrack result) { track.set(result); loaded.countDown(); }
        public void playlistLoaded(AudioPlaylist list) { loaded.countDown(); }
        public void noMatches() { loaded.countDown(); }
        public void loadFailed(FriendlyException error) { failure.set(error); loaded.countDown(); }
      });
      if (!loaded.await(30, TimeUnit.SECONDS) || track.get() == null) {
        report("failed", 0, target, -1, "metadata-load-failed"); return;
      }
      target = Math.min(target, Math.max(1000L, track.get().getDuration() - 1000L));
      player.startTrack(track.get(), false);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90);
      while (frames * 20 < target && System.nanoTime() < deadline && failure.get() == null) {
        AudioFrame frame = player.provide();
        if (frame != null && frame.getData().length > 0) {
          if (first < 0) { first = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began); report("first-audio", 0, target, first, ""); }
          frames++;
        } else Thread.sleep(10);
      }
      Set<String> reasons = new LinkedHashSet<>();
      classify(failure.get(), reasons, 0);
      if (frames * 20 < target && reasons.isEmpty()) reasons.add("no-audio-or-timeout");
      report(frames * 20 >= target ? "ok" : "failed", frames, target, first, String.join(",", reasons));
    } finally { player.destroy(); manager.shutdown(); }
  }
}
