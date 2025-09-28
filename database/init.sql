CREATE TABLE IF NOT EXISTS public."user"
(
    id serial NOT NULL,
    login character varying NOT NULL,
    password character varying NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT user_login UNIQUE (login)
);

CREATE TABLE IF NOT EXISTS public.session
(
    id serial NOT NULL,
    name character varying NOT NULL,
    username character varying NOT NULL,
    "timestamp" timestamp without time zone NOT NULL DEFAULT now(),
    ping timestamp without time zone,
    CONSTRAINT session_id PRIMARY KEY (id),
    CONSTRAINT session_name UNIQUE (name),
    CONSTRAINT session_username_fkey FOREIGN KEY (username)
        REFERENCES public."user" (login) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);